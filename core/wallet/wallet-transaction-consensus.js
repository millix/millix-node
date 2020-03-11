import database from '../../database/database';
import eventBus from '../event-bus';
import network from '../../net/network';
import peer from '../../net/peer';
import genesisConfig from '../genesis/genesis-config';
import config from '../config/config';
import async from 'async';
import _ from 'lodash';
import wallet, {WALLET_MODE} from './wallet';


export class WalletTransactionConsensus {

    constructor() {
        this._receivedConsensusTransactionValidation = null;
        this._requestConsensusTransactionValidation  = null;
        this._transactionValidationRejected          = new Set();
        this._transactionRetryValidation             = new Set();
        this._transactionValidationNotFound          = new Set();
    }

    initialize() {
        return Promise.resolve();
    }

    getRejectedTransactionList() {
        return this._transactionValidationRejected;
    }

    getRetryTransactionList() {
        return this._transactionRetryValidation;
    }

    removeFromRetryTransactions(transactionID) {
        delete this._transactionRetryValidation[transactionID];
    }

    removeFromRejectedTransactions(transactionID) {
        delete this._transactionValidationRejected[transactionID];
    }

    resetTransactionValidationRejected() {
        this._transactionValidationRejected = new Set();
    }

    _mapToAuditPointDistance(inputs) {
        return new Promise(resolve => {
            async.mapSeries(inputs, (input, callback) => {
                database.getRepository('transaction')
                        .getTransactionMinDistance(input.transaction_id, genesisConfig.genesis_transaction)
                        .then(distance => {
                            callback(false, {
                                input,
                                distance
                            });
                        });
            }, (err, results) => {
                console.log('[consensus][oracle] double spent check distance is ', results);
                resolve(results);
            });
        });
    }

    _getValidInputOnDoubleSpend(inputs) {
        return new Promise(resolve => {
            this._mapToAuditPointDistance(inputs)
                .then(inputs => {
                    let minDistance = _.minBy(_.map(inputs, i => i.distance));
                    _.remove(inputs, i => i.distance > minDistance);
                    inputs = _.map(inputs, e => e.input);

                    let validOutput;
                    if (inputs.length === 1) {
                        validOutput = inputs[0];
                    }
                    else {
                        // they have same distance pick the one with min hash
                        // value;
                        validOutput = _.minBy(inputs, i => i.transaction_id);
                    }
                    resolve(validOutput);
                });
        });
    }

    _setAsDoubleSpend(inputs) {
        console.log('[consensus][oracle] setting ', inputs.length, ' transaction as double spend');
        async.eachSeries(inputs, (input, callback) => database.getRepository('transaction')
                                                              .setTransactionAsDoubleSpend(input.transaction_id)
                                                              .then(callback));
    }

    _validateTransaction(transactionID, connectionID, depth, transactionVisitedList) {
        const transactionRepository = database.getRepository('transaction');

        return new Promise((resolve, reject) => {
            transactionRepository.getTransactionObject(transactionID)
                                 .then(transaction => database.getRepository('audit_point')
                                                              .getAuditPointByTransaction(transactionID)
                                                              .then(auditPointID => [
                                                                  transaction,
                                                                  auditPointID
                                                              ]))
                                 .then(([transaction, auditPointID]) => {

                                     transactionVisitedList.add(transactionID);
                                     if (auditPointID) {
                                         console.log('[consensus][oracle] validated in consensus round after found in Local audit point ', auditPointID, ' at depth ', depth);
                                         return resolve();
                                     }
                                     else if (!transaction) {
                                         let ws = network.getWebSocketByID(connectionID);
                                         if (ws) {
                                             peer.transactionSyncByWebSocket(transactionID, ws);
                                         }

                                         wallet.requestTransactionFromNetwork(transactionID);

                                         return reject({
                                             cause              : 'transaction_not_found',
                                             transaction_id_fail: transactionID,
                                             message            : 'no information found for ' + transactionID
                                         });
                                     }
                                     else if (transaction.transaction_id === genesisConfig.genesis_transaction) { //TODO: change to stable transactions
                                         return resolve();
                                     }
                                     else if (depth === config.CONSENSUS_VALIDATION_REQUEST_DEPTH_MAX) {
                                         return reject({
                                             cause              : 'transaction_not_validated',
                                             transaction_id_fail: transactionID,
                                             message            : `not validated in a depth of ${depth}`
                                         });
                                     }

                                     transaction = transactionRepository.normalizeTransactionObject(transaction);

                                     let sourceTransactions = new Set();
                                     let inputTotalAmount   = 0;
                                     // get inputs and check double
                                     // spend
                                     async.everySeries(transaction.transaction_input_list, (input, callback) => {
                                         if (!transactionVisitedList.has(input.output_transaction_id)) {
                                             sourceTransactions.add(input.output_transaction_id);
                                         }

                                         transactionRepository.isInputDoubleSpend(input, transaction.transaction_id)
                                                              .then(([isDoubleSpend, inputs]) => {
                                                                  if (isDoubleSpend) {
                                                                      inputs.push({transaction_id: transaction.transaction_id, ...input});
                                                                      this._getValidInputOnDoubleSpend(inputs)
                                                                          .then(validInput => {

                                                                              if (validInput.transaction_id !== transaction.transaction_id) {
                                                                                  return callback({
                                                                                      cause              : 'double_spend',
                                                                                      transaction_id_fail: input.output_transaction_id,
                                                                                      message            : 'double spend found in ' + input.output_transaction_id
                                                                                  }, false);
                                                                              }

                                                                              let doubleSpendInputs = _.pull(inputs, validInput);
                                                                              this._setAsDoubleSpend(doubleSpendInputs);
                                                                              return callback(null, true);
                                                                          });

                                                                  }
                                                                  else {
                                                                      // get
                                                                      // the
                                                                      // total
                                                                      // millix
                                                                      // amount
                                                                      // of
                                                                      // this
                                                                      // input
                                                                      transactionRepository.getOutput(input.output_transaction_id, input.output_position)
                                                                                           .then(output => {
                                                                                               if (!output) {
                                                                                                   let ws = network.getWebSocketByID(connectionID);
                                                                                                   if (ws) {
                                                                                                       peer.transactionSyncByWebSocket(input.output_transaction_id, ws);
                                                                                                   }

                                                                                                   wallet.requestTransactionFromNetwork(input.output_transaction_id);

                                                                                                   return reject({
                                                                                                       cause              : 'transaction_not_found',
                                                                                                       transaction_id_fail: input.output_transaction_id,
                                                                                                       message            : 'no information found for ' + input.output_transaction_id
                                                                                                   });
                                                                                               }
                                                                                               inputTotalAmount += output.amount;
                                                                                               return callback(null, true);
                                                                                           })
                                                                                           .catch(() => {
                                                                                               return callback({
                                                                                                   cause              : 'peer_error',
                                                                                                   transaction_id_fail: transactionID,
                                                                                                   message            : 'generic database error when getting data for transaction id ' + input.output_transaction_id
                                                                                               }, false);
                                                                                           });
                                                                  }
                                                              });
                                     }, (err, valid) => {
                                         if (!valid) {
                                             return reject(err);
                                         }

                                         // compare input and output
                                         // amount
                                         let outputTotalAmount = 0;
                                         _.each(transaction.transaction_output_list, output => {
                                             outputTotalAmount += output.amount;
                                         });

                                         if (outputTotalAmount > inputTotalAmount) {
                                             return reject({
                                                 cause              : 'transaction_invalid_amount',
                                                 transaction_id_fail: transactionID,
                                                 message            : 'output amount is greater than input amount in transaction id ' + transactionID
                                             }, false);
                                         }


                                         // check inputs transactions
                                         async.everySeries(sourceTransactions, (srcTransaction, callback) => {
                                             wallet.mode === WALLET_MODE.APP ? requestAnimationFrame(() => {
                                                 this._validateTransaction(srcTransaction, connectionID, depth + 1, transactionVisitedList)
                                                     .then(() => callback(null, true))
                                                     .catch((err) => callback(err, false));
                                             }) : this._validateTransaction(srcTransaction, connectionID, depth + 1, transactionVisitedList)
                                                      .then(() => callback(null, true))
                                                      .catch((err) => callback(err, false));
                                         }, (err, valid) => {
                                             if (!valid) {
                                                 return reject(err);
                                             }
                                             resolve();
                                         });

                                     });
                                 });
        });
    }

    validateTransactionInConsensusRound(data, ws) {
        const node         = ws.node;
        const connectionID = ws.connectionID;

        const transactionID         = data.transaction_id;
        const consensusRound        = data.consensus_round;
        const transactionRepository = database.getRepository('transaction');

        console.log('[consensus][oracle] request received to validate transaction ', transactionID, ' for consensus round number ' + consensusRound);
        eventBus.emit('wallet_event_log', {
            type   : 'transaction_validation_request',
            content: data,
            from   : node
        });

        if (this._receivedConsensusTransactionValidation !== null) {
            console.log('[consensus][oracle] reject participation in consensus round. oracle already validating another transaction.');
            if (ws) {
                peer.transactionValidationResponse({
                    cause          : 'node_not_available',
                    message        : 'oracle already validating another transaction',
                    transaction_id : transactionID,
                    consensus_round: consensusRound,
                    valid          : false
                }, ws);
            }
            return;
        }

        this._receivedConsensusTransactionValidation = {
            data,
            ws
        };

        const transactionVisitedList = new Set();
        let depth                    = 0;


        this._validateTransaction(transactionID, connectionID, depth, transactionVisitedList)
            .then(() => {
                transactionRepository.getTransactionIncludePaths(transactionID)
                                     .then(paths => {
                                         const maxLength = _.reduce(paths, (max, path) => path.length > max ? path.length : max, 0);
                                         return _.find(paths, path => path.length === maxLength);
                                     })
                                     .then(path => {
                                         console.log('[consensus][oracle] transaction ', transactionID, ' was validated for a consensus');
                                         let ws = network.getWebSocketByID(connectionID);
                                         if (ws) {
                                             peer.transactionValidationResponse({
                                                 transaction_id             : transactionID,
                                                 transaction_id_include_list: path,
                                                 consensus_round            : consensusRound,
                                                 valid                      : true
                                             }, ws);
                                         }
                                         this._receivedConsensusTransactionValidation = null;
                                     });
            })
            .catch((err) => {
                console.log('[consensus][oracle] consensus error: ', err);
                let ws = network.getWebSocketByID(connectionID);
                if (ws) {
                    peer.transactionValidationResponse({
                        ...err,
                        transaction_id : transactionID,
                        consensus_round: consensusRound,
                        valid          : false
                    }, ws);
                }
                this._receivedConsensusTransactionValidation = null;
            });

    }

    _selectNodesForConsensusRound(numberOfNodes = config.CONSENSUS_ROUND_NODE_COUNT, excludeNodeList = []) {
        return new Promise(resolve => {
            resolve(_.sampleSize(_.difference(network.registeredClients, excludeNodeList), numberOfNodes));
        });
    }

    _askNodeToValidateTransaction(ws) {
        const transaction   = this._requestConsensusTransactionValidation['transaction'];
        const transactionID = transaction.transaction_id;

        if (!ws || !ws.node) {
            console.log('[consensus][request] warn: tried to ask a disconnected node for transaction validation');
            this._replaceNodeInConsensusRound(ws);
            return;
        }

        peer.transactionSendToNode({transaction}, ws);

        console.log('[consensus][request] ask ', ws.node, ' for transaction validation');
        this._requestConsensusTransactionValidation.nodes[ws.node] = {replied: false};
        peer.transactionValidationRequest({
            transaction_id : transactionID,
            consensus_round: this._requestConsensusTransactionValidation.consensus_round
        }, ws);

    }

    _replaceNodeInConsensusRound(ws) {
        _.pull(this._requestConsensusTransactionValidation['nodes_candidate'], ws);
        const candidate = this._selectNodesForConsensusRound(1, this._requestConsensusTransactionValidation.nodes_candidate);
        ws              = _.head(candidate);
        if (ws) {
            this._requestConsensusTransactionValidation['nodes_candidate'].push(ws);
            this._askNodeToValidateTransaction(ws);
        }
    }

    _startConsensusRound(transactionID) {
        return new Promise(resolve => {

            const transactionRepository = database.getRepository('transaction');

            this._requestConsensusTransactionValidation['consensus_round']    = 0;
            this._requestConsensusTransactionValidation['double_spend_count'] = 0;
            this._requestConsensusTransactionValidation['transaction_id']     = transactionID;
            this._requestConsensusTransactionValidation['resolve']            = resolve;

            transactionRepository.getTransactionObject(transactionID)
                                 .then(dbTransaction => transactionRepository.normalizeTransactionObject(dbTransaction))
                                 .then(transaction => wallet.getWalletAddresses().then(addresses => [
                                     transaction,
                                     addresses
                                 ]))
                                 .then(([transaction, addresses]) => {

                                     if (!transaction) { // transaction data not found
                                         this._requestConsensusTransactionValidation = null;
                                         delete this._transactionRetryValidation[transactionID];
                                         return resolve();
                                     }

                                     addresses = addresses.map(address => address.address_base);
                                     async.everySeries(transaction.transaction_input_list, (input, callback) => {
                                         transactionRepository.isInputDoubleSpend(input, transactionID)
                                                              .then(([isDoubleSpend, inputs]) => callback(null, !isDoubleSpend));
                                     }, (err, valid) => {
                                         // if (!valid) {
                                         //     console.log("[Consensus] double
                                         // spend found: ", transactionID);
                                         // delete
                                         // this._activeConsensusRound[transactionID];
                                         // return; }

                                         console.log('[consensus][request] ', transactionID, ' is ready for consensus round');

                                         if (transactionID === genesisConfig.genesis_transaction
                                             || (transaction.transaction_signature_list.length === 1 && transaction.transaction_output_list.length === 1 //self-transaction
                                                 && transaction.transaction_signature_list[0].address_base === transaction.transaction_output_list[0].address_base
                                                 && addresses.includes(transaction.transaction_signature_list[0].address_base))) {
                                             this._requestConsensusTransactionValidation = null;
                                             delete this._transactionRetryValidation[transactionID];
                                             return transactionRepository.setTransactionAsStable(transactionID)
                                                                         .then(() => transactionRepository.setOutputAsStable(transactionID))
                                                                         .then(() => transactionRepository.setInputsAsSpend(transactionID))
                                                                         .then(() => setTimeout(() => this.doValidateTransaction().then(() => resolve()), 0));
                                         }

                                         let _runRound = () => {
                                             this._selectNodesForConsensusRound()
                                                 .then(selectedNodeList => {
                                                     if (selectedNodeList.length !== config.CONSENSUS_ROUND_NODE_COUNT) {
                                                         console.log('[consensus][request] no node ready for this consensus round');
                                                         this._requestConsensusTransactionValidation = null;
                                                         delete this._transactionRetryValidation[transactionID];
                                                         return resolve();
                                                     }

                                                     if (!this._requestConsensusTransactionValidation || this._requestConsensusTransactionValidation.transaction_id !== transactionID) {
                                                         console.log('[consensus][request] no consensus round found for transaction ', transactionID);
                                                         return resolve();
                                                     }

                                                     this._requestConsensusTransactionValidation['nodes']           = {};
                                                     this._requestConsensusTransactionValidation['timestamp']       = new Date().getTime();
                                                     this._requestConsensusTransactionValidation['nodes_candidate'] = selectedNodeList;
                                                     this._requestConsensusTransactionValidation['transaction']     = transaction;

                                                     eventBus.on('transaction_validation_response:' + transactionID + ':' + this._requestConsensusTransactionValidation.consensus_round, (data, ws) => {

                                                         if (!this._requestConsensusTransactionValidation || this._requestConsensusTransactionValidation.transaction_id !== transactionID || !this._requestConsensusTransactionValidation.nodes ||
                                                             !this._requestConsensusTransactionValidation.nodes[ws.node] || this._requestConsensusTransactionValidation.consensus_round !== data.consensus_round ||
                                                             this._requestConsensusTransactionValidation.nodes[ws.node].replied) {
                                                             return;
                                                         }

                                                         console.log('[consensus][request] received reply for this consensus round from ', ws.node);

                                                         eventBus.emit('wallet_event_log', {
                                                             type   : 'transaction_validation_response',
                                                             content: data,
                                                             from   : ws.node
                                                         });

                                                         if (data.cause === 'node_not_available') {
                                                             this._replaceNodeInConsensusRound(ws);
                                                             return;
                                                         }

                                                         this._requestConsensusTransactionValidation.nodes[ws.node]['data']    = data;
                                                         this._requestConsensusTransactionValidation.nodes[ws.node]['replied'] = true;

                                                         if (data.cause === 'double_spend') {
                                                             this._requestConsensusTransactionValidation.double_spend_count++;
                                                             if (this._requestConsensusTransactionValidation.double_spend_count >= config.CONSENSUS_ROUND_DOUBLE_SPEND_MAX) {
                                                                 console.log('[consensus][request] the transaction ', transactionID, ' was not validated (due to double spend) during consensus round number ', this._requestConsensusTransactionValidation.consensus_round);
                                                                 eventBus.removeAllListeners('transaction_validation_response:' + transactionID + ':' + this._requestConsensusTransactionValidation.consensus_round);
                                                                 transactionRepository.setTransactionAsDoubleSpend(transaction)
                                                                                      .then(() => wallet._checkIfWalletUpdate(_.map(transaction.transaction_output_list, o => o.address_base + o.address_version + o.address_key_identifier)))
                                                                                      .then(() => {
                                                                                          this._requestConsensusTransactionValidation = null;
                                                                                          delete this._transactionRetryValidation[transactionID];
                                                                                          resolve();
                                                                                      })
                                                                                      .catch(() => {
                                                                                          this._requestConsensusTransactionValidation = null;
                                                                                          delete this._transactionRetryValidation[transactionID];
                                                                                          resolve();
                                                                                      });
                                                                 return;
                                                             }
                                                         }

                                                         let validationCount     = 0;
                                                         let transactionNotFound = true;
                                                         for (let wsNode of _.keys(this._requestConsensusTransactionValidation.nodes)) {
                                                             if (this._requestConsensusTransactionValidation.nodes[wsNode].replied === false) {
                                                                 return;
                                                             }

                                                             if (this._requestConsensusTransactionValidation.nodes[wsNode].data.valid) {
                                                                 validationCount += 1;
                                                             }

                                                             transactionNotFound = transactionNotFound && this._requestConsensusTransactionValidation.nodes[wsNode].data.cause === 'transaction_not_found';
                                                         }

                                                         let valid = validationCount >= 2 / 3 * config.CONSENSUS_ROUND_NODE_COUNT;

                                                         if (!valid) {
                                                             console.log('[consensus][request] the transaction ', transactionID, ' was not validated during consensus round number ', this._requestConsensusTransactionValidation.consensus_round);
                                                             eventBus.removeAllListeners('transaction_validation_response:' + transactionID + ':' + this._requestConsensusTransactionValidation.consensus_round);

                                                             if (transactionNotFound) {
                                                                 if (this._transactionValidationNotFound[transactionID]) {
                                                                     this._transactionValidationNotFound[transactionID] += 1;
                                                                     if (this._transactionValidationNotFound[transactionID] >= config.CONSENSUS_ROUND_NOT_FOUND_MAX) {
                                                                         console.log('[consensus][request] the transaction ', transactionID, ' was not validated (due to not found reply) during consensus round number ', this._requestConsensusTransactionValidation.consensus_round);
                                                                         this._requestConsensusTransactionValidation = null;
                                                                         delete this._transactionRetryValidation[transactionID];
                                                                         transactionRepository.timeoutTransaction(transactionID);
                                                                         return resolve();
                                                                     }
                                                                 }
                                                                 else {
                                                                     this._transactionValidationNotFound[transactionID] = 1;
                                                                 }
                                                             }

                                                             this._requestConsensusTransactionValidation.consensus_round += 1;
                                                             if (this._requestConsensusTransactionValidation.consensus_round === config.CONSENSUS_ROUND_VALIDATION_MAX) {
                                                                 this._requestConsensusTransactionValidation = null;
                                                                 this._transactionValidationRejected.add(transactionID);
                                                                 resolve();
                                                             }
                                                             else {
                                                                 setTimeout(() => this._requestConsensusTransactionValidation['run'](), 5000);
                                                             }
                                                         }
                                                         else {
                                                             console.log('[consensus][request] transaction ', transactionID, ' validated after receiving all replies for this consensus round');
                                                             transactionRepository.setPathAsStableFrom(transactionID)
                                                                                  .then(() => wallet._checkIfWalletUpdate(_.map(transaction.transaction_output_list, o => o.address_base + o.address_version + o.address_key_identifier)));
                                                             eventBus.removeAllListeners('transaction_validation_response:' + transactionID + ':' + this._requestConsensusTransactionValidation.consensus_round);
                                                             this._requestConsensusTransactionValidation = null;
                                                             delete this._transactionRetryValidation[transactionID];
                                                             resolve();
                                                         }
                                                     });

                                                     _.each(selectedNodeList, ws => this._askNodeToValidateTransaction(ws));
                                                 });
                                         };

                                         this._requestConsensusTransactionValidation['run'] = _runRound;
                                         _runRound();
                                     });
                                 });
        });
    }

    doConsensusTransactionValidationWatchDog() {
        let transactionID = this._requestConsensusTransactionValidation ? this._requestConsensusTransactionValidation.transaction_id : null;
        if (transactionID && (new Date().getTime() - this._requestConsensusTransactionValidation.timestamp) >= config.CONSENSUS_VALIDATION_WAIT_TIME_MAX) {
            console.log('[consensus][watchdog] killed by watch dog txid: ', transactionID, 'round:', this._requestConsensusTransactionValidation.consensus_round);
            eventBus.removeAllListeners('transaction_validation_response:' + transactionID + ':' + this._requestConsensusTransactionValidation.consensus_round);
            this._requestConsensusTransactionValidation.consensus_round += 1;
            if (this._requestConsensusTransactionValidation.consensus_round === config.CONSENSUS_ROUND_VALIDATION_MAX) {
                this._requestConsensusTransactionValidation.resolve();
                this._requestConsensusTransactionValidation = null;
                this._transactionValidationRejected.add(transactionID);
            }
            else {
                this._requestConsensusTransactionValidation.run();
            }
        }
        return Promise.resolve();
    }

    doValidateTransaction() {
        if (this._requestConsensusTransactionValidation !== null) {
            console.log('[consensus][request] a consensus round is running', this._requestConsensusTransactionValidation);
            return Promise.resolve();
        }

        this._requestConsensusTransactionValidation = {};

        let excludeTransactionList = Array.from(this._transactionValidationRejected.keys());
        if (excludeTransactionList.length > 900) { //max sqlite parameters are 999
            excludeTransactionList = _.sample(excludeTransactionList, 900);
        }

        console.log('[consensus][request] get unstable transactions');
        return new Promise(resolve => {


            database.getRepository('keychain')
                    .getWalletAddresses(wallet.getDefaultActiveWallet())
                    .then(addresses => database.getRepository('address')
                                               .getAddressesUnstableTransactions(addresses.map(address => address.address), config.CONSENSUS_ROUND_PATH_LENGTH_MIN, excludeTransactionList))
                    .then(pendingTransactions => pendingTransactions.length === 0 ? database.getRepository('transaction')
                                                                                            .findUnstableTransaction(config.CONSENSUS_ROUND_PATH_LENGTH_MIN, excludeTransactionList)
                                                                                            .then(transactions => [
                                                                                                transactions,
                                                                                                false
                                                                                            ]) : [
                        pendingTransactions,
                        true
                    ])
                    .then(([pendingTransactions, isNodeTransaction]) => {
                        console.log('[consensus][request] get unstable transactions done');
                        let rejectedTransactions = _.remove(pendingTransactions, t => this._transactionValidationRejected.has(t.transaction_id));
                        let pendingTransaction   = pendingTransactions[0];

                        if (!pendingTransaction) {
                            pendingTransaction = rejectedTransactions[0];
                        }

                        if (!pendingTransaction) {
                            console.log('[consensus][request] no pending funds available for validation.');
                            this._requestConsensusTransactionValidation = null;
                            return Promise.resolve();
                        }

                        console.log('[consensus][request] starting consensus round for ', pendingTransaction.transaction_id);

                        if (isNodeTransaction) {
                            this._transactionRetryValidation[pendingTransaction.transaction_id] = Date.now();
                        }
                        return this._startConsensusRound(pendingTransaction.transaction_id);
                    })
                    .then(() => resolve())
                    .catch(() => {
                        this._requestConsensusTransactionValidation = null;
                        resolve();
                    });
        });
    }

}


export default new WalletTransactionConsensus();
