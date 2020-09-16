import database from '../../database/database';
import eventBus from '../event-bus';
import network from '../../net/network';
import peer from '../../net/peer';
import genesisConfig from '../genesis/genesis-config';
import config from '../config/config';
import async from 'async';
import _ from 'lodash';
import wallet from './wallet';


export class WalletTransactionConsensus {

    constructor() {
        this._transactionValidationState    = {
            /*[ws.nodeID]: {
             transaction_id: id,
             timestamp: int
             }*/
        };
        this._consensusRoundState           = {
            /*[transaction.transaction_id]: {
             consensus_round_validation_count  : int,
             consensus_round_double_spend_count: int,
             consensus_round_not_found_count   : int,
             consensus_round_count             : int,
             consensus_round_response: array,
             timestamp: int,
             resolve : func,
             active  : bool
             }*/
        };
        this._transactionValidationRejected = new Set();
        this._transactionRetryValidation    = new Set();
        this._transactionValidationNotFound = new Set();
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
                            callback(null, {
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
            let validTransaction    = null;
            let transactionNotFound = null;
            async.eachSeries(inputs, (input, callback) => {
                database.firstShardZeroORShardRepository('transaction', input.transaction_id, transactionRepository => {
                    return new Promise((resolve, reject) => {
                        transactionRepository.getTransaction(input.transaction_id)
                                             .then(transaction => transaction ? resolve(transaction) : reject()).catch(reject);
                    });
                }).then(transaction => {
                    if (!transaction) {
                        transactionNotFound = {transaction_id: input.transaction_id};
                        return callback(true);
                    }
                    else if (!validTransaction || transaction.transaction_date < validTransaction.transaction_date
                             || ((transaction.transaction_date < validTransaction.transaction_date) && (transaction.transaction_id < validTransaction.transaction_id))) {
                        validTransaction = transaction;
                    }
                    callback();
                }).catch(() => callback());
            }, () => resolve({
                transaction_valid    : validTransaction,
                transaction_not_found: transactionNotFound
            }));
        });
    }

    _setAsDoubleSpend(transactions, doubleSpendTransaction) {
        console.log('[consensus][oracle] setting ', transactions.length, ' transaction as double spend');
        async.eachSeries(transactions, (transaction, callback) => database.firstShards((shardID) => {
            return new Promise((resolve, reject) => {
                const transactionRepository = database.getRepository('transaction', shardID);
                transactionRepository.getTransactionObject(transaction.transaction_id)
                                     .then(transaction => transaction ? transactionRepository.setTransactionAsDoubleSpend(transaction, doubleSpendTransaction).then(() => resolve())
                                                                      : reject());
            });
        }).then(() => callback()));
    }

    _validateTransaction(transactionID, nodeID, depth, transactionVisitedList) {
        return new Promise((resolve, reject) => {
            database.firstShards((shardID) => {
                return new Promise((resolve, reject) => {
                    const transactionRepository = database.getRepository('transaction', shardID);
                    transactionRepository.getTransactionObject(transactionID)
                                         .then(transaction => transaction ? resolve([
                                             transaction,
                                             shardID
                                         ]) : reject());
                });
            }).then(data => {
                const [transaction, shardID] = data || [];
                if (!transaction) {
                    return [];
                }
                return database.getRepository('audit_point', shardID)
                               .getAuditPoint(transactionID)
                               .then(auditPoint => [
                                   transaction,
                                   auditPoint ? auditPoint.audit_point_id : undefined
                               ]);
            }).then(([transaction, auditPointID]) => {

                transactionVisitedList.add(transactionID);
                if (transaction && transaction.is_stable && _.every(transaction.transaction_output_list, output => output.is_stable && !output.is_double_spend)) {
                    console.log('[consensus][oracle] validated in consensus round after found a validated transaction at depth ', depth);
                    return resolve();
                }
                else if (auditPointID) {
                    console.log('[consensus][oracle] validated in consensus round after found in Local audit point ', auditPointID, ' at depth ', depth);
                    return resolve();
                }
                else if (!transaction) {
                    return reject({
                        cause              : 'transaction_not_found',
                        transaction_id_fail: transactionID,
                        message            : 'no information found for ' + transactionID
                    });
                }
                else if (transaction.transaction_id === genesisConfig.genesis_transaction) {
                    return resolve();
                }
                else if (depth === config.CONSENSUS_VALIDATION_REQUEST_DEPTH_MAX) {
                    return reject({
                        cause              : 'transaction_validation_max_depth',
                        transaction_id_fail: transactionID,
                        message            : `not validated in a depth of ${depth}`
                    });
                }

                transaction = database.getRepository('transaction').normalizeTransactionObject(transaction);

                let sourceTransactions = new Set();
                let inputTotalAmount   = 0;
                // get inputs and check double
                // spend
                async.everySeries(transaction.transaction_input_list, (input, callback) => {
                    if (!transactionVisitedList.has(input.output_transaction_id)) {
                        sourceTransactions.add(input.output_transaction_id);
                    }

                    database.firstShards((shardID) => {
                        return new Promise((resolve, reject) => {
                            const transactionRepository = database.getRepository('transaction', shardID);
                            transactionRepository.isInputDoubleSpend(input, transaction.transaction_id)
                                                 .then(([isDoubleSpend, inputs]) => isDoubleSpend ? resolve([
                                                     isDoubleSpend,
                                                     inputs
                                                 ]) : reject());
                        });
                    }).then(data => data || []).then(([isDoubleSpend, inputs]) => {
                        if (isDoubleSpend) {
                            inputs.push({transaction_id: transaction.transaction_id, ...input});
                            this._getValidInputOnDoubleSpend(inputs)
                                .then(({transaction_valid: validInput, transaction_not_found: transactionNotFound}) => {

                                    if (validInput && validInput.transaction_id !== transaction.transaction_id) {
                                        return callback({
                                            cause              : 'transaction_double_spend',
                                            transaction_id_fail: input.output_transaction_id,
                                            message            : 'double spend found in ' + input.output_transaction_id
                                        }, false);
                                    }
                                    else if (transactionNotFound) {
                                        return callback({
                                            cause              : 'transaction_not_found',
                                            transaction_id_fail: transactionNotFound.transaction_id,
                                            message            : 'no information found for ' + transactionNotFound.transaction_id
                                        }, false);
                                    }

                                    let doubleSpendInputs = _.pull(inputs, validInput);
                                    this._setAsDoubleSpend(doubleSpendInputs, input.output_transaction_id);
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
                            database.firstShards((shardID) => {
                                return new Promise((resolve, reject) => {
                                    const transactionRepository = database.getRepository('transaction', shardID);
                                    transactionRepository.getOutput(input.output_transaction_id, input.output_position)
                                                         .then(output => output ? resolve(output) : reject());
                                });
                            }).then(output => {
                                if (!output) {
                                    return callback({
                                        cause              : 'transaction_not_found',
                                        transaction_id_fail: input.output_transaction_id,
                                        message            : 'no information found for ' + input.output_transaction_id
                                    }, false);
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
                    if (!valid) { //not valid
                        return reject(err);
                    }

                    if (!this._transactionValidationState[nodeID] || (Date.now() - this._transactionValidationState[nodeID].timestamp) >= config.CONSENSUS_VALIDATION_WAIT_TIME_MAX) { //timeout has been triggered
                        return reject({
                            cause: 'consensus_timeout',
                            depth
                        });
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
                        });
                    }


                    // check inputs transactions
                    async.everySeries(sourceTransactions, (srcTransaction, callback) => {
                        this._validateTransaction(srcTransaction, nodeID, depth + 1, transactionVisitedList)
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

    _validateTransactionInConsensusRound(data, ws) {
        const {node, nodeID, connectionID} = ws;
        const transactionID                = data.transaction_id;

        console.log('[consensus][oracle] request received to validate transaction ', transactionID);
        eventBus.emit('wallet_event_log', {
            type   : 'transaction_validation_request',
            content: data,
            from   : node
        });

        const transactionVisitedList = new Set();
        let depth                    = 0;

        this._transactionValidationState[nodeID]['timestamp'] = Date.now();
        this._validateTransaction(transactionID, nodeID, depth, transactionVisitedList)
            .then(() => {
                console.log('[consensus][oracle] transaction ', transactionID, ' was validated for a consensus');
                let ws = network.getWebSocketByID(connectionID);
                if (ws) {
                    peer.transactionValidationResponse({
                        transaction_id: transactionID,
                        valid         : true,
                        type          : 'validation_response'
                    }, ws, true);
                }
                delete this._transactionValidationState[nodeID];
            })
            .catch((err) => {
                console.log('[consensus][oracle] consensus error: ', err);

                delete this._transactionValidationState[nodeID];
                let ws = network.getWebSocketByID(connectionID);
                if (err.cause === 'consensus_timeout') {
                    return;
                }
                else if (err.cause === 'transaction_not_found') {
                    ws && peer.transactionSyncByWebSocket(err.transaction_id_fail, ws).then(_ => _);
                    wallet.requestTransactionFromNetwork(err.transaction_id_fail);
                }

                if (ws) {
                    peer.transactionValidationResponse({
                        ...err,
                        transaction_id: transactionID,
                        valid         : false,
                        type          : 'validation_response'
                    }, ws, true);
                }
            });

    }

    _selectNodesForConsensusRound(numberOfNodes = config.CONSENSUS_ROUND_NODE_COUNT, excludeNodeSet = new Set()) {
        return _.sampleSize(_.filter(network.registeredClients, ws => ws.nodeConnectionReady && (ws.outBound || ws.bidirectional) && !excludeNodeSet.has(ws.nodeID)), numberOfNodes);
    }

    _isNeedNodesInConsensusRound(transactionID) {
        const consensusData = this._consensusRoundState[transactionID];
        if (!consensusData) {
            return false;
        }

        // check if we have all answers
        const consensusNodeIDList = _.keys(consensusData.consensus_round_response[consensusData.consensus_round_count]);
        return consensusNodeIDList.length < config.CONSENSUS_ROUND_NODE_COUNT;
    }

    _startConsensusRound(transactionID) {
        return database.firstShards((shardID) => {
            return new Promise((resolve, reject) => {
                const transactionRepository = database.getRepository('transaction', shardID);
                transactionRepository.getTransactionObject(transactionID)
                                     .then(transaction => transaction ? resolve(transaction) : reject());
            });
        })
                       .then(dbTransaction => database.getRepository('transaction').normalizeTransactionObject(dbTransaction))
                       .then(transaction => {

                           if (!transaction) { // transaction data not found
                               console.warn('[wallet-transaction-consensus] transaction not found. unexpected behaviour.');
                               return Promise.reject();
                           }

                           console.log('[consensus][request]', transactionID, ' is ready for consensus round');
                           if (transactionID === genesisConfig.genesis_transaction) { // genesis transaction
                               return database.applyShardZeroAndShardRepository('transaction', transaction.shard_id, transactionRepository => {
                                   return transactionRepository.setTransactionAsStable(transactionID)
                                                               .then(() => transactionRepository.setOutputAsStable(transactionID))
                                                               .then(() => transactionRepository.setInputsAsSpend(transactionID));
                               });
                           }

                           return new Promise(resolve => {

                               const requestPeerValidation = () => {
                                   if (!this._isNeedNodesInConsensusRound(transactionID)) {
                                       return;
                                   }
                                   const consensusData     = this._consensusRoundState[transactionID];
                                   let consensusNodeIDList = [];
                                   for (let i = 0; i < consensusData.consensus_round_count; i++) {
                                       consensusNodeIDList = consensusNodeIDList.concat(_.keys(consensusData.consensus_round_response[i]));
                                   }
                                   const [selectedWS] = this._selectNodesForConsensusRound(1, new Set(consensusNodeIDList));

                                   if (!selectedWS) {
                                       console.log('[consensus][request] no node ready for this consensus round');
                                       //TODO: trigger peer rotation?
                                       return setTimeout(() => requestPeerValidation(), 2500);
                                   }

                                   peer.transactionSendToNode(transaction, selectedWS);

                                   consensusData.consensus_round_response[consensusData.consensus_round_count][selectedWS.nodeID] = {response: null};
                                   peer.transactionValidationRequest({transaction_id: transactionID}, selectedWS)
                                       .then(data => {
                                           if (data.type !== 'validation_start' || this._isNeedNodesInConsensusRound(transactionID)) {
                                               requestPeerValidation();
                                           }
                                       })
                                       .catch(() => {
                                           // remove node from
                                           // consensus round
                                           if (this._consensusRoundState[transactionID]) {
                                               delete this._consensusRoundState[transactionID].consensus_round_response[selectedWS.nodeID];
                                               requestPeerValidation();
                                           }
                                       });
                               };

                               requestPeerValidation();
                               this._consensusRoundState[transactionID]['transaction']           = transaction;
                               this._consensusRoundState[transactionID]['resolve']               = resolve;
                               this._consensusRoundState[transactionID]['requestPeerValidation'] = requestPeerValidation;
                           });
                       });
    }

    processTransactionValidationRequest(data, ws) {
        // deal with the allocation process

        if (_.keys(this._transactionValidationState).length >= config.CONSENSUS_VALIDATION_PARALLEL_REQUEST_MAX) {
            peer.transactionValidationResponse({
                ...data,
                type: 'node_not_available'
            }, ws);
        }
        else {
            // lock a spot in the validation queue
            this._transactionValidationState[ws.nodeID] = {transaction_id: data.transaction_id};
            peer.transactionValidationResponse({
                ...data,
                type: 'validation_start'
            }, ws);

            this._validateTransactionInConsensusRound(data, ws);
        }
    }

    _nextConsensusRound(transactionID) {
        const consensusData                = this._consensusRoundState[transactionID];
        const validationRequired           = config.CONSENSUS_ROUND_VALIDATION_REQUIRED - consensusData.consensus_round_validation_count;
        const availableConsensusRoundCount = config.CONSENSUS_ROUND_VALIDATION_MAX - consensusData.consensus_round_count;
        if (consensusData.consensus_round_count === config.CONSENSUS_ROUND_VALIDATION_MAX - 1 || availableConsensusRoundCount < validationRequired) {
            consensusData.active = false;
            this._transactionValidationRejected.add(transactionID);
            consensusData.resolve();
        }
        else {
            consensusData.consensus_round_count++;
            consensusData.consensus_round_response[consensusData.consensus_round_count] = {};
            consensusData.timestamp                                                     = Date.now();
            consensusData.requestPeerValidation();
        }
    }

    processTransactionValidationResponse(data, ws) {
        const transactionID = data.transaction_id;
        const consensusData = this._consensusRoundState[transactionID];
        if (!consensusData || !consensusData.consensus_round_response[consensusData.consensus_round_count][ws.nodeID] || !consensusData.active) {
            return;
        }

        console.log('[consensus][request] received reply for this consensus round from ', ws.node);

        eventBus.emit('wallet_event_log', {
            type   : 'transaction_validation_response',
            content: data,
            from   : ws.node
        });

        if (data.valid === false && ![
            'transaction_double_spend',
            'transaction_not_found',
            'transaction_invalid_amount',
            'transaction_validation_max_depth'
        ].includes(data.cause)) {
            delete this._consensusRoundState[transactionID].consensus_round_response[consensusData.consensus_round_count][ws.nodeID];
            this._consensusRoundState[transactionID].requestPeerValidation();
            return;
        }
        else if (data.cause === 'transaction_not_found') {
            return database.firstShards((shardID) => {
                return new Promise((resolve, reject) => {
                    const transactionRepository = database.getRepository('transaction', shardID);
                    transactionRepository.getTransactionObject(data.transaction_id_fail)
                                         .then(transaction => transaction ? resolve(transactionRepository.normalizeTransactionObject(transaction)) : reject());
                });
            }).then(transaction => peer.transactionSendToNode(transaction, ws));
        }

        const consensusResponseData      = this._consensusRoundState[transactionID].consensus_round_response[consensusData.consensus_round_count];
        consensusResponseData[ws.nodeID] = {response: data};

        if (_.keys(consensusResponseData).length < config.CONSENSUS_ROUND_NODE_COUNT) {
            return;
        }

        // check if we have all responses
        let counter = {
            valid       : 0,
            double_spend: 0,
            not_found   : 0
        };

        for (let [_, {response}] of Object.entries(consensusResponseData)) {
            if (!response) {
                return;
            }
            if (response.valid === true) {
                counter.valid++;
            }
            else if (response.cause === 'transaction_double_spend') {
                counter.double_spend++;
            }
            else if (response.cause === 'transaction_not_found') {
                counter.not_found++;
            }
        }

        // check consensus result
        const responseCount = _.keys(consensusResponseData).length;
        const isValid       = counter.valid >= 2 / 3 * responseCount;
        const transaction   = consensusData.transaction;
        if (!isValid) {
            console.log('[consensus][request] the transaction ', transactionID, ' was not validated during consensus round number', consensusData.consensus_round_count);
            let isDoubleSpend = counter.double_spend >= 2 / 3 * responseCount;
            let isNotFound    = counter.not_found >= 2 / 3 * responseCount;
            if (isDoubleSpend) {
                consensusData.consensus_round_double_spend_count++;
                if (consensusData.consensus_round_double_spend_count >= config.CONSENSUS_ROUND_DOUBLE_SPEND_MAX) {
                    consensusData.active = false;
                    this._transactionValidationRejected.add(transactionID);
                    console.log('[consensus][request] the transaction ', transactionID, ' was not validated (due to double spend) during consensus round number ', consensusData.consensus_round_count);
                    return database.applyShardZeroAndShardRepository('transaction', transaction.shard_id, transactionRepository => {
                        return transactionRepository.setTransactionAsDoubleSpend(transaction, data.transaction_id_fail /*double spend input*/);
                    }).then(() => wallet._checkIfWalletUpdate(new Set(_.map(transaction.transaction_output_list, o => o.address_key_identifier))))
                                   .then(() => {
                                       consensusData.resolve();
                                   })
                                   .catch(() => {
                                       consensusData.resolve();
                                   });
                }
            }
            else if (isNotFound) {
                consensusData.consensus_round_double_spend_count++;
                if (consensusData.consensus_round_not_found_count >= config.CONSENSUS_ROUND_NOT_FOUND_MAX) {
                    consensusData.active = false;
                    console.log('[consensus][request] the transaction ', transactionID, ' was not validated (due to not found reply) during consensus round number ', consensusData.consensus_round_count);
                    this._transactionValidationRejected.add(transactionID);
                    return database.applyShardZeroAndShardRepository('transaction', transaction.shard_id, transactionRepository => {
                        return transactionRepository.timeoutTransaction(transactionID);
                    }).then(() => {
                        consensusData.resolve();
                    });
                }
            }
        }
        else {
            console.log('[consensus][request] transaction ', transactionID, ' validated after receiving all replies for this consensus round');
            consensusData.consensus_round_validation_count++;
            if (consensusData.consensus_round_validation_count >= config.CONSENSUS_ROUND_VALIDATION_REQUIRED) {
                consensusData.active = false;
                return database.applyShardZeroAndShardRepository('transaction', transaction.shard_id, transactionRepository => {
                    return transactionRepository.setPathAsStableFrom(transactionID);
                }).then(() => wallet._checkIfWalletUpdate(new Set(_.map(transaction.transaction_output_list, o => o.address_key_identifier))))
                               .then(() => {
                                   consensusData.resolve();
                               })
                               .catch(() => {
                                   consensusData.resolve();
                               });
            }
        }
        this._nextConsensusRound(transactionID);
    }

    doConsensusTransactionValidationWatchDog() {
        for (let [transactionID, consensusData] of Object.entries(this._consensusRoundState)) {
            if ((Date.now() - consensusData.timestamp) >= config.CONSENSUS_VALIDATION_WAIT_TIME_MAX) {
                console.log('[consensus][watchdog] killed by watch dog txid: ', transactionID);
                consensusData.resolve();
                delete this._consensusRoundState[transactionID];
                this._transactionValidationRejected.add(transactionID);
            }
        }

        for (let [nodeID, validationData] of Object.entries(this._transactionValidationState)) {
            if ((Date.now() - validationData.timestamp) >= config.CONSENSUS_VALIDATION_WAIT_TIME_MAX) {
                delete this._transactionValidationState[nodeID];
            }
        }

        return Promise.resolve();
    }

    doValidateTransaction() {
        const consensusCount = _.keys(this._consensusRoundState).length;
        if (consensusCount >= config.CONSENSUS_VALIDATION_PARALLEL_PROCESS_MAX) {
            console.log('[consensus][request] maximum number of transactions validation running reached : ', config.CONSENSUS_VALIDATION_PARALLEL_PROCESS_MAX);
            return Promise.resolve();
        }

        let excludeTransactionList = Array.from(this._transactionValidationRejected.keys());
        if (excludeTransactionList.length > 900) { //max sqlite parameters are 999
            excludeTransactionList = _.sample(excludeTransactionList, 900);
        }

        // lock a spot in the consensus state
        const lockerID                      = `locker-${consensusCount}`;
        this._consensusRoundState[lockerID] = true;
        console.log('[consensus][request] get unstable transactions');
        return new Promise(resolve => {
            database.applyShards((shardID) => {
                return database.getRepository('transaction', shardID)
                               .getWalletUnstableTransactions(wallet.defaultKeyIdentifier, excludeTransactionList);
            }).then(pendingTransactions => {
                if (pendingTransactions.length === 0) {
                    return database.applyShards((shardID) => {
                        return database.getRepository('transaction', shardID)
                                       .findUnstableTransaction(excludeTransactionList);
                    }).then(transactions => [
                        transactions,
                        false
                    ]);
                }
                else {
                    return [
                        pendingTransactions,
                        true
                    ];
                }
            }).then(([pendingTransactions, isNodeTransaction]) => {
                console.log('[consensus][request] get unstable transactions done');
                let rejectedTransactions = _.remove(pendingTransactions, t => this._transactionValidationRejected.has(t.transaction_id));
                let pendingTransaction   = pendingTransactions[0];

                if (!pendingTransaction) {
                    pendingTransaction = rejectedTransactions[0];
                }

                if (!pendingTransaction) {
                    console.log('[consensus][request] no pending funds available for validation.');
                    delete this._consensusRoundState[lockerID];
                    return resolve();
                }

                const transactionID = pendingTransaction.transaction_id;
                console.log('[consensus][request] starting consensus round for ', transactionID);

                if (isNodeTransaction) {
                    this._transactionRetryValidation[transactionID] = Date.now();
                }

                // replace lock id with transaction id
                delete this._consensusRoundState[lockerID];
                this._consensusRoundState[transactionID] = {
                    consensus_round_validation_count  : 0,
                    consensus_round_double_spend_count: 0,
                    consensus_round_not_found_count   : 0,
                    consensus_round_count             : 0,
                    consensus_round_response          : [{}],
                    timestamp                         : Date.now(),
                    active                            : true
                };
                return this._startConsensusRound(transactionID).then(() => {
                    // release spot
                    delete this._transactionRetryValidation[transactionID];
                    delete this._consensusRoundState[transactionID];
                    resolve();
                }).catch(() => {
                    // release spot
                    delete this._transactionRetryValidation[transactionID];
                    delete this._consensusRoundState[transactionID];
                    resolve();
                });
            }).catch(() => {
                resolve();
            });
        });
    }

}


export default new WalletTransactionConsensus();
