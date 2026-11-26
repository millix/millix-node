import database from '../../database/database';
import eventBus from '../event-bus';
import network from '../../net/network';
import peer from '../../net/peer';
import peerRotation from '../../net/peer-rotation';
import genesisConfig from '../genesis/genesis-config';
import config from '../config/config';
import async from 'async';
import _ from 'lodash';
import wallet from './wallet';
import walletUtils from './wallet-utils';
import ntp from '../ntp';
import console from '../console';
import task from '../task';
import cache from '../cache';
import walletSync from './wallet-sync';
import mutex from '../mutex';
import {NodeVersion} from '../utils/utils';
import escrow from './escrow';


export class WalletTransactionConsensus {
    clearState() {
        for (const consensusData of Object.values(this._consensusRoundState || {})) {
            consensusData.resolve?.();
        }

        this._transactionValidationState            = {
            /*[ws.nodeID]: {
             transaction_id: id,
             timestamp: int
             }*/
        };
        this._consensusRoundState                   = {
            /*[transaction.transaction_id]: {
             consensus_round_validation_count  : int,
             consensus_round_invalid_count     : int,
             consensus_round_double_spend_count: int,
             consensus_round_not_found_count   : int,
             consensus_round_count             : int,
             consensus_round_response          : array,
             consensus_round_node_discard      : array,
             timestamp: int,
             resolve : func,
             active  : bool
             }*/
        };
        this._transactionValidationRejected         = new Set();
        this._validationReservations                = new Set();
        this._validationPrepareState                = {
            /*[transaction.transaction_id] : {
             transaction_not_found_count: int
             }*/
        };
        this._validationWatchDogState               = {
            /*[transaction.transaction_id]: {
             timestamp: int
             }*/
        };
        this._transactionRetryValidation            = {};
        this._transactionObjectCache                = {};
        this._lastTransactionValidatedTimestamp     = undefined;
        this.transactionValidationCount             = 0;
    }

    initialize() {
        this.clearState();
        task.scheduleTask('wallet_transaction_consensus_do_transaction_validation', () => this.doValidateTransaction(), 15000);
        return Promise.resolve();
    }

    stop() {
        task.removeTask('wallet_transaction_consensus_do_transaction_validation');
    }

    isRunningValidationForWalletTransaction() {
        return _.some(this._consensusRoundState, 'is_wallet_transaction');
    }

    addTransactionToCache(transaction) {
        this._transactionObjectCache[transaction.transaction_id] = transaction;
    }

    deleteTransactionFromCache(transactionID) {
        delete this._transactionObjectCache[transactionID];
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
        this._transactionValidationRejected.delete(transactionID);
    }

    resetTransactionValidationRejected() {
        this._transactionValidationRejected = new Set();
    }

    _getValidInputOnDoubleSpend(doubleSpendTransactionID, targetTransactionId, inputs, nodeID, transactionVisitedSet, doubleSpendSet, proxyTimeStart, proxyTimeLimit, startTime) {
        return new Promise(resolve => {
            let responseType = 'transaction_double_spend';
            let responseData = null;
            async.eachSeries(_.sortBy(inputs, 'transaction_date'), (input, callback) => {
                database.firstShardZeroORShardRepository('transaction', input.shard_id, transactionRepository => {
                    return new Promise((resolve, reject) => {
                        transactionRepository.getTransaction(input.transaction_id)
                                             .then(transaction => transaction ? resolve(transaction) : reject()).catch(reject);
                    });
                }).then(transaction => {
                    transaction = transaction || this._transactionObjectCache[input.transaction_id];
                    if (!transaction) {
                        responseType = 'transaction_not_found';
                        responseData = {transaction_id: input.transaction_id};
                        return callback(true);
                    }
                    else if (transaction.status === 3) { // invalid transaction
                        return transaction.transaction_id === targetTransactionId ? callback(true) : callback();
                    }
                    else if (!doubleSpendSet.has(transaction.transaction_id) && (!responseData || ((transaction.transaction_date.getTime() === responseData.transaction_date.getTime()) && (transaction.transaction_id < responseData.transaction_id)))) {

                        let newVisitedTransactionSet = new Set(transactionVisitedSet);
                        newVisitedTransactionSet.add(doubleSpendTransactionID);
                        this._validateTransaction(transaction.transaction_id, nodeID, 0, newVisitedTransactionSet, doubleSpendSet, proxyTimeStart, proxyTimeLimit, startTime)
                            .then(() => {
                                responseType = 'transaction_valid';
                                responseData = transaction;
                                callback();
                            })
                            .catch(err => {
                                if (err.cause === 'transaction_double_spend') {
                                    doubleSpendSet.add(transaction.transaction_id);
                                    return transaction.transaction_id === targetTransactionId ? callback(true) : callback();
                                }
                                else if (err.cause === 'transaction_invalid') {
                                    return transaction.transaction_id === targetTransactionId ? callback(true) : callback();
                                }
                                else if (err.cause === 'transaction_not_found') {
                                    responseType = err.cause;
                                    responseData = {transaction_id: err.transaction_id_fail};
                                }
                                else if (err.cause === 'proxy_time_limit_exceed') {
                                    responseType = err.cause;
                                    responseData = {};
                                }
                                else {
                                    responseType = 'transaction_double_spend_unresolved';
                                    responseData = {transaction_id: transaction.transaction_id};
                                }
                                callback(true);
                            });
                    }
                    else if (transaction.transaction_id === targetTransactionId || responseData && transaction.transaction_date.getTime() > responseData.transaction_date.getTime()) {
                        callback(true);
                    }
                    else {
                        callback();
                    }
                }).catch(() => callback());
            }, () => resolve({
                response_type: responseType,
                data         : responseData
            }));
        });
    }

    _validateTransaction(transaction, nodeID, depth = 0, transactionVisitedSet = new Set(), doubleSpendSet = new Set(), proxyTimeStart = null, proxyTimeLimit = null, startTime = Date.now()) {
        let transactionID;
        if (typeof (transaction) === 'object') {
            transactionID = transaction.transaction_id;
        }
        else {
            transactionID = transaction;
            transaction   = null;
        }
        return new Promise((resolve, reject) => {
            let deferRecovery = false;
            const onUnavailableRead = () => deferRecovery = true;
            const readOptions = {onMissingSignatures: onUnavailableRead, onReadError: onUnavailableRead};
            (() => transaction ? Promise.resolve(transaction) :
                   this._transactionObjectCache[transactionID] ? Promise.resolve(this._transactionObjectCache[transactionID]) :
                   database.firstShards((shardID) => {
                       return new Promise((resolve, reject) => {
                           const transactionRepository = database.getRepository('transaction', shardID);
                           transactionRepository.getTransactionObject(transactionID, readOptions)
                                                .then(transaction => transaction ? resolve(transaction) : reject());
                       });
                   }))().then((transaction) => {

                const hasUnboundSigner = transaction?.is_stable !== undefined && walletUtils.hasUnboundTransactionSigner(transaction);
                if (transaction && transaction.status !== 3 && !hasUnboundSigner && transaction.is_stable && _.every(transaction.transaction_output_list, output => output.is_stable && !output.is_double_spend)) {
                    console.log('[wallet-transaction-consensus-oracle] validated in consensus round after find a validated transaction at depth ', depth, '. after:', Date.now() - startTime, 'ms');
                    return resolve();
                }
                else if (transaction && (transaction.status === 3 || hasUnboundSigner)) {
                    console.log('[wallet-transaction-consensus-oracle] found invalid transaction ', transaction.transaction_id);
                    return reject({
                        cause              : 'transaction_invalid',
                        transaction_id_fail: transactionID,
                        message            : 'invalid transaction found: ' + transactionID
                    });
                }
                else if (transaction && transaction.is_stable && _.some(transaction.transaction_output_list, output => output.is_double_spend === 1) ||
                         doubleSpendSet.has(transactionID)) {
                    return reject({
                        cause                         : 'transaction_double_spend',
                        transaction_id_fail           : transactionID,
                        transaction_input_double_spend: _.pick(_.find(transaction.transaction_input_list, {is_double_spend: 1}) || transaction.transaction_input_list[0], [
                            'output_transaction_id',
                            'output_position',
                            'output_shard_id'
                        ]),
                        message                       : 'double spend found in ' + transactionID
                    });
                }
                else if (transaction && transaction.transaction_id === genesisConfig.genesis_transaction) {
                    return resolve();
                }
                else if (transactionVisitedSet.has(transactionID)) {
                    return resolve();
                }
                else if (depth === config.CONSENSUS_VALIDATION_REQUEST_DEPTH_MAX) {
                    return reject({
                        cause              : 'transaction_validation_max_depth',
                        transaction_id_fail: transactionID,
                        message            : `not validated in a depth of ${depth}`
                    });
                }

                if (transaction && transaction.is_stable !== undefined) { // transaction object needs to be normalized
                    transaction = database.getRepository('transaction').normalizeTransactionObject(transaction);
                    if (!transaction && !deferRecovery) {
                        database.applyShards(shardID => {
                            const transactionRepository = database.getRepository('transaction', shardID);
                            return transactionRepository.deleteTransaction(transactionID);
                        }).then(_ => wallet.requestTransactionFromNetwork(transactionID, {
                            priority        : 1,
                            dispatch_request: true
                        }));
                    }
                }

                if (!transaction) {
                    if (!deferRecovery && config.MODE_NODE_SYNC_FULL) {
                        wallet.requestTransactionFromNetwork(transactionID, {
                            priority        : 1,
                            dispatch_request: true
                        });
                    }

                    return reject({
                        cause              : 'transaction_not_found',
                        transaction_id_fail: transactionID,
                        message            : 'no information found for ' + transactionID
                    });
                }

                walletUtils.verifyTransaction(transaction)
                           .then(([valid, invalidTransactionError]) => {
                               if (!valid) {
                                   console.log('[wallet-transaction-consensus-oracle] transaction data was is not valid ', transaction.transaction_id);

                                   if (['transaction_consume_expired_output', 'transaction_object_invalid', 'transaction_date_invalid', 'transaction_refresh_invalid'].includes(invalidTransactionError)) {
                                       return reject({
                                           cause              : 'transaction_invalid',
                                           transaction_id_fail: transaction.transaction_id,
                                           message            : `transaction was is not valid (${invalidTransactionError}): ${transaction.transaction_id}`
                                       });
                                   }

                                   if (!deferRecovery) {
                                       database.applyShards(shardID => {
                                           return database.getRepository('transaction', shardID).deleteTransaction(transaction.transaction_id);
                                       }).then(_ => _);
                                   }
                                   return reject({
                                       cause              : 'transaction_not_found',
                                       transaction_id_fail: transaction.transaction_id,
                                       message            : `transaction data was is not valid: ${transaction.transaction_id}`
                                   });
                               }

                               transactionVisitedSet.add(transactionID);

                               let sourceTransactions        = new Set();
                               let inputTotalAmount          = 0;
                               const outputUsedInTransaction = new Set();
                               // get inputs and check double
                               // spend
                               async.everySeries(transaction.transaction_input_list, (input, callback) => {
                                   if (doubleSpendSet.has(input.output_transaction_id)) {
                                       return callback({
                                           cause                         : 'transaction_double_spend',
                                           transaction_id_fail           : transaction.transaction_id,
                                           transaction_input_double_spend: _.pick(input, [
                                               'output_transaction_id',
                                               'output_position',
                                               'output_shard_id'
                                           ]),
                                           message                       : 'double spend found in ' + transaction.transaction_id
                                       }, false);
                                   }

                                   (() => {
                                       if (!transactionVisitedSet.has(input.output_transaction_id)) {
                                           sourceTransactions.add(input);
                                           return database.applyShards((shardID) => database.getRepository('transaction', shardID).getInputDoubleSpend(input, transaction.transaction_id)).then(data => data || []);
                                       }
                                       else {
                                           return Promise.resolve([]);
                                       }
                                   })().then(doubleSpendTransactions => {
                                       return new Promise((resolve, reject) => {
                                           if (doubleSpendTransactions.length > 0) {
                                               doubleSpendTransactions.push({
                                                   transaction_id  : transaction.transaction_id,
                                                   shard_id        : transaction.shard_id,
                                                   transaction_date: Math.floor(walletUtils.getTransactionDateFromNormalizedObject(transaction).getTime() / 1000),
                                                   ...input
                                               });
                                               this._getValidInputOnDoubleSpend(input.output_transaction_id, input.transaction_id, doubleSpendTransactions, nodeID, transactionVisitedSet, doubleSpendSet, proxyTimeStart, proxyTimeLimit, startTime)
                                                   .then(({
                                                              response_type: responseType,
                                                              data
                                                          }) => {

                                                       if ((responseType === 'transaction_double_spend' && !data) ||
                                                           (responseType === 'transaction_valid' && data.transaction_id !== transaction.transaction_id)) {
                                                           return reject({
                                                               cause                         : 'transaction_double_spend',
                                                               transaction_id_fail           : transaction.transaction_id,
                                                               message                       : 'double spend found in ' + transaction.transaction_id,
                                                               transaction_input_double_spend: _.pick(input, [
                                                                   'output_transaction_id',
                                                                   'output_position',
                                                                   'output_shard_id'
                                                               ])
                                                           });
                                                       }
                                                       else if (responseType === 'transaction_not_found') {

                                                           if (config.MODE_NODE_SYNC_FULL) {
                                                               wallet.requestTransactionFromNetwork(data.transaction_id, {
                                                                   priority        : 1,
                                                                   dispatch_request: true
                                                               });
                                                           }

                                                           return reject({
                                                               cause              : responseType,
                                                               transaction_id_fail: data.transaction_id,
                                                               message            : 'no information found for ' + data.transaction_id
                                                           });
                                                       }
                                                       else if (responseType === 'transaction_double_spend_unresolved') {
                                                           if (config.MODE_NODE_SYNC_FULL) {
                                                               peer.transactionSyncRequest(data.transaction_id, {
                                                                   dispatch_request  : true,
                                                                   force_request_sync: true
                                                               }).then(_ => _).catch(_ => _);
                                                           }
                                                           return reject({
                                                               cause              : 'transaction_double_spend_unresolved',
                                                               transaction_id_fail: data.transaction_id,
                                                               message            : 'unresolved double spend. unknown state of transaction id ' + data.transaction_id
                                                           });
                                                       }
                                                       else if (responseType === 'proxy_time_limit_exceed') {
                                                           return reject({
                                                               cause  : responseType,
                                                               message: 'transaction proxy time limit exceeded'
                                                           });
                                                       }

                                                       resolve();
                                                   });
                                           }
                                           else {
                                               resolve();
                                           }
                                       });
                                   }).then(() => {
                                       /* get the total millix amount of this input */
                                       database.firstShards((shardID) => {
                                           return new Promise((resolve, reject) => {
                                               if (this._transactionObjectCache[input.output_transaction_id]) {
                                                   return resolve(_.find(this._transactionObjectCache[input.output_transaction_id].transaction_output_list, {output_position: input.output_position}));
                                               }
                                               const transactionRepository = database.getRepository('transaction', shardID);
                                               transactionRepository.getOutput(input.output_transaction_id, input.output_position)
                                                                    .then(output => output ? resolve(output) : reject());
                                           });
                                       }).then(output => {
                                           if (!output) {

                                               if (config.MODE_NODE_SYNC_FULL) {
                                                   wallet.requestTransactionFromNetwork(input.output_transaction_id, {
                                                       priority        : 1,
                                                       dispatch_request: true
                                                   });
                                               }

                                               return callback({
                                                   cause              : 'transaction_not_found',
                                                   transaction_id_fail: input.output_transaction_id,
                                                   message            : 'no information found for ' + input.output_transaction_id
                                               }, false);
                                           }

                                           let outputID = input.output_transaction_id + ':' + input.output_position;

                                           const outputAddress = output.address || `${output.address_base}${output.address_version}${output.address_key_identifier}`;

                                           if (outputUsedInTransaction.has(outputID)) {
                                               console.log(`[wallet-transaction-consensus-oracle] transaction ${transaction.transaction_id} is invalid because output already used ${outputID}`, transaction.transaction_input_list);
                                               return callback({
                                                   cause              : 'transaction_invalid',
                                                   transaction_id_fail: input.output_transaction_id,
                                                   message            : 'output already used ' + outputID
                                               }, false);
                                           }
                                           else if (outputAddress !== `${input.address_base}${input.address_version}${input.address_key_identifier}`) {
                                               console.log(`[wallet-transaction-consensus-oracle] transaction ${transaction.transaction_id} is invalid because invalid input address ${input.address_base}${input.address_version}${input.address_key_identifier}`, output);
                                               return callback({
                                                   cause              : 'transaction_invalid',
                                                   transaction_id_fail: transactionID,
                                                   message            : `invalid input address ${input.address_base}${input.address_version}${input.address_key_identifier}`
                                               }, false);
                                           }
                                           outputUsedInTransaction.add(outputID);
                                           inputTotalAmount += output.amount;
                                           return callback(null, true);
                                       }).catch(() => {
                                           return callback({
                                               cause              : 'peer_error',
                                               transaction_id_fail: transactionID,
                                               message            : 'generic database error when getting data for transaction id ' + input.output_transaction_id
                                           }, false);
                                       });
                                   }).catch(err => {
                                       callback(err, false);
                                   });
                               }, (err, valid) => {
                                   if (err && !valid) { //not valid
                                       return reject(err);
                                   }

                                   if (nodeID && (!this._transactionValidationState[nodeID] || (Date.now() - this._transactionValidationState[nodeID].timestamp) >= config.CONSENSUS_VALIDATION_WAIT_TIME_MAX)) { //timeout has been triggered
                                       return reject({
                                           cause: 'consensus_timeout',
                                           depth
                                       });
                                   }
                                   else if (proxyTimeLimit != null && proxyTimeStart != null && (Date.now() - proxyTimeStart) >= proxyTimeLimit) {
                                       return reject({
                                           cause: 'proxy_time_limit_exceed',
                                           depth
                                       });
                                   }

                                   /* compare input and output amount */
                                   let outputTotalAmount = 0;
                                   _.each(transaction.transaction_output_list, output => {
                                       outputTotalAmount += output.amount;
                                   });

                                   if (outputTotalAmount > inputTotalAmount) {
                                       console.log(`[wallet-transaction-consensus-oracle] transaction ${transaction.transaction_id} is invalid because invalid amount ${outputTotalAmount} > ${inputTotalAmount}`);
                                       return reject({
                                           cause              : 'transaction_invalid_amount',
                                           transaction_id_fail: transactionID,
                                           message            : 'output amount is greater than input amount in transaction id ' + transactionID
                                       });
                                   }


                                   // check inputs transactions
                                   async.everySeries(sourceTransactions, (srcTransaction, callback) => {
                                       this._validateTransaction(this._transactionObjectCache[srcTransaction.output_transaction_id] || srcTransaction.output_transaction_id, nodeID, depth + 1, transactionVisitedSet, doubleSpendSet, proxyTimeStart, proxyTimeLimit, startTime)
                                           .then(() => callback(null, true))
                                           .catch((err) => {
                                               if (err && err.cause === 'transaction_double_spend' && !err.transaction_input_double_spend) {
                                                   err.transaction_input_double_spend = _.pick(srcTransaction, [
                                                       'output_transaction_id',
                                                       'output_position',
                                                       'output_shard_id'
                                                   ]);
                                               }
                                               callback(err, false);
                                           });
                                   }, (err, valid) => {
                                       if (err && !valid) {
                                           return reject(err);
                                       }
                                       resolve();
                                   });

                               });
                           });
            });
        });
    }

    _validateTransactionInConsensusRound(data, ws) {
        const {
                  node,
                  nodeID,
                  connectionID
              }             = ws;
        const transactionID = data.transaction_id;

        if (!this._transactionValidationState[ws.nodeID] ||
            this._transactionValidationState[ws.nodeID].transaction_id !== data.transaction_id ||
            !!this._transactionValidationState[ws.nodeID].timestamp) {
            return peer.transactionValidationResponse({
                cause              : 'transaction_validation_unexpected',
                transaction_id_fail: transactionID,
                transaction_id     : transactionID,
                valid              : false,
                type               : 'validation_response'
            }, ws, true);
        }

        console.log('[wallet-transaction-consensus-oracle] request received to validate transaction ', transactionID);
        eventBus.emit('wallet_event_log', {
            type   : 'transaction_validation_start',
            content: data,
            from   : node
        });

        this._transactionValidationState[nodeID]['timestamp'] = Date.now();
        this._validateTransaction(transactionID, nodeID)
            .then(() => {
                console.log('[wallet-transaction-consensus-oracle] transaction ', transactionID, ' was validated for a consensus');
                let ws = network.getWebSocketByID(connectionID);
                if (ws) {
                    const validationResult = {
                        transaction_id: transactionID,
                        valid         : true,
                        type          : 'validation_response'
                    };
                    cache.setCacheItem('validation', transactionID, validationResult, 90000);
                    peer.transactionValidationResponse(validationResult, ws, true);
                }
                delete this._transactionValidationState[nodeID];
            })
            .catch((err) => {
                console.log('[wallet-transaction-consensus-oracle] consensus error: ', err);

                delete this._transactionValidationState[nodeID];
                let ws        = network.getWebSocketByID(connectionID);
                let cacheTime = 90000;
                if (err.cause === 'consensus_timeout') {
                    return;
                }
                else if (err.cause === 'transaction_not_found') {
                    if (config.MODE_NODE_SYNC_FULL) {
                        ws && peer.transactionSyncByWebSocket(err.transaction_id_fail, ws).then(_ => _);
                        wallet.requestTransactionFromNetwork(err.transaction_id_fail);
                    }
                    cacheTime = 2000;
                }

                if (ws) {
                    const validationResult = {
                        ...err,
                        transaction_id: transactionID,
                        valid         : false,
                        type          : 'validation_response'
                    };
                    cache.setCacheItem('validation', transactionID, validationResult, cacheTime);
                    peer.transactionValidationResponse(validationResult, ws, true);
                }
            });

    }

    _selectNodesForConsensusRound(numberOfNodes = config.CONSENSUS_ROUND_NODE_COUNT, excludeNodeSet = new Set(), transaction = null) {
        // escrow transactions are validated only by nodes that know the
        // escrow rules
        const minSupportedNodeVersion = new NodeVersion(1, 22, 1);
        return _.sampleSize(_.filter(network.registeredClients, ws => {
            const nodeVersion = NodeVersion.fromString(ws.features.version);
            return ws.nodeConnectionReady && !excludeNodeSet.has(ws.nodeID) && nodeVersion && nodeVersion.compareTo(minSupportedNodeVersion) >= 0 &&
                   (!transaction || escrow.isNodeVersionAccepted(ws, transaction.transaction_input_list, transaction.transaction_output_list));
        }), numberOfNodes);
    }

    _isNeedNodesInConsensusRound(consensusData) {
        // check if we have all answers
        const consensusNodeIDList = _.keys(consensusData.consensus_round_response[consensusData.consensus_round_count]);
        return consensusNodeIDList.length < config.CONSENSUS_ROUND_NODE_COUNT * 3;
    }

    _startConsensusRound(transactionID) {
        const consensusData = this._consensusRoundState?.[transactionID];
        const isCurrentRound = () => this._consensusRoundState?.[transactionID] === consensusData;
        let deferRecovery = false;
        const onUnavailableRead = () => deferRecovery = true;
        const readOptions = {onMissingSignatures: onUnavailableRead, onReadError: onUnavailableRead};
        return database.firstShards((shardID) => {
            return new Promise((resolve, reject) => {
                const transactionRepository = database.getRepository('transaction', shardID);
                transactionRepository.getTransactionObject(transactionID, readOptions)
                                     .then(transaction => transaction ? resolve(transaction) : reject());
            });
        }).then(dbTransaction => {
            const hasUnboundSigner = walletUtils.hasUnboundTransactionSigner(dbTransaction);
            const transactionRepository = database.getRepository('transaction');
            try {
                const transaction = transactionRepository.normalizeTransactionObject(dbTransaction);
                return {transaction: transaction || (hasUnboundSigner ? dbTransaction : null), hasUnboundSigner};
            }
            catch (error) {
                if (!hasUnboundSigner) {
                    throw error;
                }
                return {transaction: dbTransaction, hasUnboundSigner};
            }
        }).then(({transaction, hasUnboundSigner}) => {
            if (!isCurrentRound()) {
                return Promise.reject();
            }
            if (!transaction) { // transaction data not found
                if (deferRecovery) {
                    return Promise.reject();
                }
                console.log('[wallet-transaction-consensus-validation] transaction not found. unexpected behaviour.');
                this._transactionValidationRejected.add(transactionID);
                this._transactionRetryValidation[transactionID] = Date.now() + 5 * 60 * 1000; // allow retry in 5min
                return database.applyShards(shardID => {
                    const transactionRepository = database.getRepository('transaction', shardID);
                    return transactionRepository.deleteTransaction(transactionID);
                }).then(_ => wallet.requestTransactionFromNetwork(transactionID, {
                    priority        : 1,
                    dispatch_request: true
                })).then(() => Promise.reject());
            }

            const verification = hasUnboundSigner ? Promise.resolve([false, 'transaction_object_invalid']) : walletUtils.verifyTransaction(transaction);
            return verification
                              .then(([isValid, invalidTransactionError]) => {
                                  if (!isCurrentRound()) {
                                      return Promise.reject();
                                  }
                                  if (!isValid) {

                                      if (['transaction_consume_expired_output', 'transaction_object_invalid', 'transaction_date_invalid', 'transaction_refresh_invalid'].includes(invalidTransactionError)) {
                                          return database.applyShards((shardID) => {
                                              const transactionRepository = database.getRepository('transaction', shardID);
                                              return transactionRepository.invalidateTransaction(transactionID)
                                                                          .then(() => transactionRepository.clearTransactionObjectCache(transactionID));
                                          }).then(() => {
                                              wallet._checkIfWalletUpdate(new Set(_.map(transaction?.transaction_output_list || [], o => o.address_key_identifier)));
                                              wallet.notifyTransactionChanged([transaction], 'transaction_validation:invalid');
                                          }).then(() => Promise.reject());
                                      }

                                      if (deferRecovery) {
                                          return Promise.reject();
                                      }
                                      return database.applyShards(shardID => {
                                          return database.getRepository('transaction', shardID).deleteTransaction(transaction.transaction_id);
                                      }).then(() => Promise.reject());
                                  }

                                  return transaction;
                              });
        }).then(transaction => {
            if (!isCurrentRound()) {
                return Promise.reject();
            }
            console.log('[wallet-transaction-consensus-status]', transactionID, ' is ready for consensus round');
            if (transactionID === genesisConfig.genesis_transaction) { // genesis transaction
                return database.applyShardZeroAndShardRepository('transaction', transaction.shard_id, transactionRepository => {
                    return transactionRepository.setTransactionAsStable(transactionID)
                                                .then(() => transactionRepository.setOutputAsStable(transactionID))
                                                .then(() => transactionRepository.setInputsAsSpend(transactionID));
                });
            }

            if (!consensusData) {
                return Promise.reject();
            }

            let scheduledRequestPeerValidation = false;
            return new Promise(resolve => {
                const requestPeerValidation = () => {
                    console.log('[wallet-transaction-consensus-validation] requesting peer for validation.');
                    if (!isCurrentRound() || !consensusData.active || !this._isNeedNodesInConsensusRound(consensusData)) {
                        console.log('[wallet-transaction-consensus-validation] no more peer needed yet.');
                        return;
                    }
                    consensusData.timestamp = Date.now();
                    let consensusNodeIDList = [...consensusData.consensus_round_node_discard];
                    for (let i = 0; i < consensusData.consensus_round_count + 1; i++) {
                        consensusNodeIDList = consensusNodeIDList.concat(_.keys(consensusData.consensus_round_response[i]));
                    }
                    const [selectedWS] = this._selectNodesForConsensusRound(1, new Set(consensusNodeIDList), transaction);

                    if (!selectedWS) {
                        console.log('[wallet-transaction-consensus-validation] no node ready for this consensus round');
                        //TODO: trigger peer rotation? check the
                        // best way to do it
                        if (!scheduledRequestPeerValidation) {
                            scheduledRequestPeerValidation = true;
                            return setTimeout(() => {
                                scheduledRequestPeerValidation = false;
                                requestPeerValidation();
                            }, 4000);
                        }
                        return;
                    }

                    console.log('[wallet-transaction-consensus-validation] new node selected for consensus ', selectedWS.nodeID);
                    consensusData.consensus_round_response[consensusData.consensus_round_count][selectedWS.nodeID] = {
                        response : null,
                        timestamp: Date.now()
                    };
                    const consensusRoundNumber                                                                     = consensusData.consensus_round_count;
                    peer.transactionValidationRequest({transaction_id: transactionID}, selectedWS)
                        .then(data => {
                            selectedWS.consensusTimeoutCount = 0;
                            if (!isCurrentRound() || !consensusData.active) {
                                return;
                            }
                            if (data.type !== 'validation_start') {
                                console.log('[wallet-transaction-consensus-validation] node', selectedWS.node, ' did not accept to validate the transaction', transactionID);
                                consensusData.consensus_round_node_discard.add(selectedWS.nodeID);
                                if (consensusData.consensus_round_response[consensusRoundNumber]) {
                                    delete consensusData.consensus_round_response[consensusRoundNumber][selectedWS.nodeID];
                                }
                                // reset node to available
                                setTimeout(() => consensusData.consensus_round_node_discard.delete(selectedWS.nodeID), 5000);
                            }
                            else {
                                console.log('[wallet-transaction-consensus-validation] node', selectedWS.node, ' accepted to validate the transaction', transactionID);
                            }
                            if (data.type !== 'validation_start' || this._isNeedNodesInConsensusRound(consensusData)) {
                                requestPeerValidation();
                            }
                        })
                        .catch((e) => {
                            if (!isCurrentRound() || !consensusData.active) {
                                return;
                            }
                            // remove node from
                            // consensus round
                            if (e === 'node_connection_closed') {
                                console.log('[wallet-transaction-consensus-validation] disconnecting node', selectedWS.node, ', reason:', e);
                                network.disconnectWebSocket(selectedWS);
                                peerRotation.doPeerRotation();
                                if (consensusData.consensus_round_response[consensusRoundNumber]) {
                                    delete consensusData.consensus_round_response[consensusRoundNumber][selectedWS.nodeID];
                                }
                            }
                            else if (e === 'node_timeout') {
                                selectedWS.consensusTimeoutCount += 1;
                                if (selectedWS.consensusTimeoutCount >= 15) {
                                    console.log('[wallet-transaction-consensus-validation] disconnecting node ', selectedWS.node, 'reason: max timeout reached');
                                    network.disconnectWebSocket(selectedWS);
                                    peerRotation.doPeerRotation();
                                    if (consensusData.consensus_round_response[consensusRoundNumber]) {
                                        delete consensusData.consensus_round_response[consensusRoundNumber][selectedWS.nodeID];
                                    }
                                }
                            }
                            else {
                                console.log('[wallet-transaction-consensus-validation] unhandled error: ', e);
                                if (consensusData.consensus_round_response[consensusRoundNumber]) {
                                    delete consensusData.consensus_round_response[consensusRoundNumber][selectedWS.nodeID];
                                }
                            }


                            if (!scheduledRequestPeerValidation) {
                                scheduledRequestPeerValidation = true;
                                return setTimeout(() => {
                                    scheduledRequestPeerValidation = false;
                                    requestPeerValidation();
                                }, 1000);
                            }
                        });

                    if (!scheduledRequestPeerValidation) {
                        scheduledRequestPeerValidation = true;
                        return setTimeout(() => {
                            scheduledRequestPeerValidation = false;
                            requestPeerValidation();
                        }, 1000);
                    }
                };

                consensusData.transaction           = transaction;
                consensusData.resolve               = resolve;
                consensusData.requestPeerValidation = requestPeerValidation;
                requestPeerValidation();
            });
        });
    }

    processTransactionValidationRequest(data, ws) {
        const nodeVersion             = NodeVersion.fromString(ws.features?.version);
        const minSupportedNodeVersion = new NodeVersion(1, 22, 1);
        if (!nodeVersion || nodeVersion.compareTo(minSupportedNodeVersion) < 0) {
            peer.transactionValidationResponse({
                ...data,
                type: 'node_not_available'
            }, ws);
            return;
        }

        // deal with the allocation process
        const cachedValidation = cache.getCacheItem('validation', data.transaction_id);
        if (cachedValidation) {
            peer.transactionValidationResponse({
                ...data,
                type: 'validation_start'
            }, ws);
            peer.transactionValidationResponse(cachedValidation, ws, true);
            if (cachedValidation.cause !== 'transaction_not_found') {
                cache.refreshCacheTime('validation', data.transaction_id, 90000);
            }
            return;
        }

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
        const consensusData = this._consensusRoundState[transactionID];
        if (consensusData.consensus_round_count === config.CONSENSUS_ROUND_VALIDATION_MAX - 1) {
            console.log('[wallet-transaction-consensus-status] could not validate transaction', transactionID, ' using ', config.CONSENSUS_ROUND_VALIDATION_MAX, 'consensus rounds');
            consensusData.active = false;
            this._transactionValidationRejected.add(transactionID);
            this._transactionRetryValidation[transactionID] = Date.now() + 60 * 1000; // allow retry in 1min;
            consensusData.resolve && consensusData.resolve();
        }
        else {
            // clear node that did not respond
            const consensusRoundResponseData = consensusData.consensus_round_response[consensusData.consensus_round_count];
            for (let [nodeID, consensusNodeResponseData] of Object.entries(consensusRoundResponseData)) {
                if (!consensusNodeResponseData.response) {
                    delete consensusRoundResponseData[nodeID];
                }
            }

            consensusData.consensus_round_count++;
            consensusData.consensus_round_response[consensusData.consensus_round_count] = {};
            consensusData.timestamp                                                     = Date.now();
            consensusData.requestPeerValidation && consensusData.requestPeerValidation();
            console.log('[wallet-transaction-consensus-status] move to next consensus number', consensusData.consensus_round_count, 'on transaction', transactionID);
        }
    }

    processTransactionValidationResponse(data, ws) {
        const transactionID      = data.transaction_id;
        const consensusData      = this._consensusRoundState[transactionID];
        ws.consensusTimeoutCount = 0;
        if (consensusData && consensusData.active && consensusData.consensus_round_response[consensusData.consensus_round_count] &&
            !consensusData.consensus_round_response[consensusData.consensus_round_count][ws.nodeID]) {
            consensusData.consensus_round_response[consensusData.consensus_round_count][ws.nodeID] = {timestamp: Date.now()};
            console.log('[wallet-transaction-consensus-validation] response reused in active consensus round ', data);
        }
        else if (!ws || !consensusData || !consensusData.consensus_round_response || !consensusData.consensus_round_response[consensusData.consensus_round_count][ws.nodeID] || !consensusData.active) {
            console.log('[wallet-transaction-consensus-validation] response discarded ', data);
            return;
        }

        // update time to timeout
        consensusData.timestamp = Date.now();

        console.log('[wallet-transaction-consensus-validation] received reply for this consensus round from ', ws.node);
        console.log('[wallet-transaction-consensus-validation] response', data, 'after', Date.now() - consensusData.consensus_round_response[consensusData.consensus_round_count][ws.nodeID].timestamp, 'ms');

        eventBus.emit('wallet_event_log', {
            type   : 'transaction_validation_response',
            content: data,
            from   : ws.node
        });

        if (data.valid === false && ![
            'transaction_double_spend',
            'transaction_not_found',
            'transaction_invalid',
            'transaction_invalid_amount'
        ].includes(data.cause)) {
            delete consensusData.consensus_round_response[consensusData.consensus_round_count][ws.nodeID];
            consensusData.consensus_round_node_discard.add(ws.nodeID);
            consensusData.requestPeerValidation && consensusData.requestPeerValidation();
            return;
        }

        const consensusResponseData      = this._consensusRoundState[transactionID].consensus_round_response[consensusData.consensus_round_count];
        consensusResponseData[ws.nodeID] = {response: data};

        // check if we have all responses
        let counter = {
            valid       : 0,
            invalid     : 0,
            double_spend: 0,
            not_found   : 0
        };

        let responseCount                = 0;
        const notFoundResponseNodeIDList = [];
        for (let [nodeID, {response}] of Object.entries(consensusResponseData)) {
            if (!response) {
                continue;
            }

            responseCount++;

            if (response.valid === true) {
                counter.valid++;
            }
            else if (response.cause === 'transaction_double_spend') {
                counter.double_spend++;
            }
            else if (response.cause === 'transaction_not_found') {
                if (response.transaction_id_fail === response.transaction_id) {
                    delete consensusData.consensus_round_response[consensusData.consensus_round_count][ws.nodeID];
                    consensusData.consensus_round_node_discard.add(ws.nodeID);
                    consensusData.requestPeerValidation && consensusData.requestPeerValidation();
                    console.log('[wallet-transaction-consensus-status] consensus status ', counter, 'event:', response.cause);
                    return;
                }

                counter.not_found++;
                notFoundResponseNodeIDList.push(nodeID);
            }
            else { /* 'transaction_invalid', 'transaction_invalid_amount' */
                counter.invalid++;
            }
        }

        if (counter.not_found > 0 && (counter.invalid > 0
                                      || counter.double_spend > 0
                                      || counter.valid > 0
                                      || consensusData.consensus_round_invalid_count > 0
                                      || consensusData.consensus_round_validation_count > 0
                                      || consensusData.consensus_round_double_spend_count > 0)) { // if there is any response that is not not_found we reset the not_found ones
            notFoundResponseNodeIDList.forEach(nodeID => {
                delete consensusData.consensus_round_response[consensusData.consensus_round_count][nodeID];
                consensusData.consensus_round_node_discard.add(nodeID);
                consensusData.requestPeerValidation && consensusData.requestPeerValidation();
            });
            console.log('[wallet-transaction-consensus-status] consensus status ', counter, ' event:', data.cause ?? 'transaction_valid');
            return;
        }

        // check consensus result
        // const responseCount = _.keys(consensusResponseData).length;

        console.log('[wallet-transaction-consensus-status] consensus status ', counter, 'tx:', transactionID);
        if (responseCount < config.CONSENSUS_ROUND_NODE_COUNT) {
            return;
        }

        const isValid     = counter.valid >= 2 / 3 * responseCount;
        const transaction = consensusData.transaction;
        console.log('[wallet-transaction-consensus-status] current consensus status', _.pick(consensusData, [
            'consensus_round_validation_count',
            'consensus_round_invalid_count',
            'consensus_round_double_spend_count',
            'consensus_round_not_found_count',
            'consensus_round_count'
        ]));

        if (!isValid) {
            console.log('[wallet-transaction-consensus-status] the transaction', transactionID, 'was not validated during consensus round number', consensusData.consensus_round_count);
            let isDoubleSpend = counter.double_spend >= 2 / 3 * responseCount;
            let isNotFound    = counter.not_found >= 2 / 3 * responseCount;
            let isInvalid     = (counter.invalid + counter.double_spend) >= 2 / 3 * responseCount;
            if (isDoubleSpend) {
                consensusData.consensus_round_double_spend_count++;
                console.log('[wallet-transaction-consensus-status] increase number of double spend rounds to', consensusData.consensus_round_double_spend_count, 'tx:', transactionID);
                if (consensusData.consensus_round_double_spend_count >= config.CONSENSUS_ROUND_DOUBLE_SPEND_MAX) {
                    cache.removeCacheItem('validation', transactionID);
                    consensusData.active = false;
                    this._transactionValidationRejected.add(transactionID);
                    this._transactionRetryValidation[transactionID] = Date.now() + 5 * 60 * 1000; // if required, allow retry in 5min
                    console.log('[wallet-transaction-consensus-status] the transaction', transactionID, 'was not validated (due to double spend) during consensus round number', consensusData.consensus_round_count);
                    return database.applyShards(shardID => {
                        const transactionRepository = database.getRepository('transaction', shardID);
                        return transactionRepository.updateTransactionAsDoubleSpend(transactionID, data.transaction_input_double_spend /*double spend input*/)
                                                    .then(() => transactionRepository.clearTransactionObjectCache(transactionID));
                    }).then(() => {
                        if (transaction) {
                            return transaction;
                        }
                        return database.firstShards(shardID => database.getRepository('transaction', shardID)
                                                                       .getTransactionObject(transactionID));
                    }).then(transaction => this.resetInputsSpentByTransaction(transaction).then(() => this.resetValidTransactionSpendingFromDoubleSpendTransaction(transaction)))
                                   .then(transaction => {
                                       wallet._checkIfWalletUpdate(new Set(_.map(transaction?.transaction_output_list || [], o => o.address_key_identifier)));
                                       wallet.notifyTransactionChanged([transaction], 'transaction_validation:double_spend');
                                   })
                                   .then(() => consensusData.resolve && consensusData.resolve())
                                   .catch(() => consensusData.resolve && consensusData.resolve());
                }
            }
            else if (isNotFound) {
                consensusData.consensus_round_not_found_count++;
                console.log('[wallet-transaction-consensus-status] increase number of not found rounds to', consensusData.consensus_round_not_found_count, 'tx:', transactionID);
                if (consensusData.consensus_round_not_found_count >= config.CONSENSUS_ROUND_NOT_FOUND_MAX) {
                    cache.removeCacheItem('validation', transactionID);
                    consensusData.active = false;
                    console.log('[wallet-transaction-consensus-status] the transaction', transactionID, 'was not validated (due to not found reply) during consensus round number', consensusData.consensus_round_count);
                    this._transactionValidationRejected.add(transactionID);
                    this._transactionRetryValidation[transactionID] = Date.now() + 60 * 1000; // allow retry in 1 min
                    return Promise.resolve().then(() => database.applyShards(shardID => {
                        const transactionRepository = database.getRepository('transaction', shardID);
                        return transactionRepository.timeoutTransaction(transactionID)
                                                    .then(() => transactionRepository.clearTransactionObjectCache(transactionID));
                    })).then(() => wallet.notifyTransactionChanged([transaction], 'transaction_validation:timeout'))
                       .catch(error => console.log('[wallet-transaction-consensus-status] failed to finalize not-found transaction', transactionID, error))
                       .finally(() => consensusData.resolve?.());
                }
            }
            else if (isInvalid) {
                consensusData.consensus_round_invalid_count++;
                console.log('[wallet-transaction-consensus-status] increase number of invalid rounds to', consensusData.consensus_round_invalid_count, 'tx:', transactionID);
                if (consensusData.consensus_round_invalid_count >= config.CONSENSUS_ROUND_DOUBLE_SPEND_MAX) {
                    cache.removeCacheItem('validation', transactionID);
                    consensusData.active = false;
                    console.log('[wallet-transaction-consensus-status] the transaction', transactionID, 'was not validated (due to not invalid tx) during consensus round number', consensusData.consensus_round_count);
                    this._transactionValidationRejected.add(transactionID);
                    if (consensusData.consensus_round_double_spend_count === 0
                        && consensusData.consensus_round_validation_count === 0) { // only invalidate the transaction if all rounds are invalid
                        return database.applyShards((shardID) => {
                            const transactionRepository = database.getRepository('transaction', shardID);
                            return transactionRepository.invalidateTransaction(transactionID)
                                                        .then(() => {
                                                            if (transaction) {
                                                                return transaction;
                                                            }
                                                            return database.firstShards(shardID => database.getRepository('transaction', shardID)
                                                                                                           .getTransactionObject(transactionID));
                                                        })
                                                        .then(transaction => this.resetInputsSpentByTransaction(transaction).then(() => this.resetValidTransactionSpendingFromInvalidTransaction(transaction)))
                                                        .then(() => transactionRepository.clearTransactionObjectCache(transactionID));
                        }).then(() => {
                            wallet._checkIfWalletUpdate(new Set(_.map(transaction?.transaction_output_list || [], o => o.address_key_identifier)));
                            wallet.notifyTransactionChanged([transaction], 'transaction_validation:invalid');
                        }).then(() => consensusData.resolve && consensusData.resolve()).catch(() => consensusData.resolve && consensusData.resolve());
                    }

                    consensusData.resolve && consensusData.resolve();
                    return;
                }
            }
        }
        else {
            consensusData.consensus_round_validation_count++;
            console.log('[wallet-transaction-consensus-status] increase number of valid rounds to', consensusData.consensus_round_validation_count, 'tx:', transactionID);
            if (consensusData.consensus_round_validation_count >= config.CONSENSUS_ROUND_VALIDATION_REQUIRED) {
                console.log('[wallet-transaction-consensus-status] transaction', transactionID, 'validated during consensus round number', consensusData.consensus_round_count);
                cache.removeCacheItem('validation', transactionID);
                consensusData.active                    = false;
                this._lastTransactionValidatedTimestamp = Date.now();
                this.transactionValidationCount++;
                return (() => {
                    if (transaction) {
                        return Promise.resolve(transaction);
                    }
                    return database.firstShards(shardID => database.getRepository('transaction', shardID)
                                                                   .getTransactionObject(transactionID));
                })().then(transaction => {
                    if (transaction) {
                        walletSync.syncTransactionSpendingOutputs(transaction, config.MODE_NODE_SYNC_FULL);
                    }
                    else {
                        console.log('[wallet-transaction-consensus-validation] unexpected null transaction object detected');
                    }
                    return database.applyShards(shardID => {
                        const transactionRepository = database.getRepository('transaction', shardID);
                        return transactionRepository.updateTransactionAsStable(transactionID)
                                                    .then(() => transactionRepository.clearTransactionObjectCache(transactionID));
                    }).then(() => {
                        // check data consistency
                        const inputTransactions = _.uniq(transaction.transaction_input_list.map(i => i.output_transaction_id));
                        return new Promise(resolve => {
                            async.eachSeries(inputTransactions, (inputTransactionID, callback) => {
                                database.firstShards(shardID => {
                                    const transactionRepository = database.getRepository('transaction', shardID);
                                    return transactionRepository.getTransactionOutputs(inputTransactionID)
                                                                .then(outputs => outputs.length > 0 ? Promise.resolve([
                                                                    outputs[0],
                                                                    transactionRepository
                                                                ]) : Promise.reject());
                                }).then(data => {
                                    if (!data) {
                                        return;
                                    }
                                    const [output, transactionRepository] = data;
                                    if (output) {
                                        if (output.status === 3 || output.is_double_spend === 1) {
                                            // reset transaction status
                                            return transactionRepository.resetTransaction(output.transaction_id);
                                        }
                                    }
                                }).then(() => callback());
                            }, () => resolve());
                        });
                    }).then(() => {
                        wallet._checkIfWalletUpdate(new Set(_.map(transaction?.transaction_output_list || [], o => o.address_key_identifier)));
                        wallet.notifyTransactionChanged([transaction], 'transaction_validation:valid');
                    });
                }).then(() => consensusData.resolve && consensusData.resolve())
                    .catch(() => consensusData.resolve && consensusData.resolve());
            }
        }
        this._nextConsensusRound(transactionID);
    }

    resetValidTransactionSpendingFromInvalidTransaction(transaction) {
        if (!transaction) {
            return Promise.resolve();
        }

        return database.applyShards(sharID => database.getRepository('transaction', sharID).listTransactionInput({
            '+`transaction`.status!'  : 3,
            '+`transaction`.is_stable': 1,
            'output_transaction_id'   : transaction.transaction_id
        })).then(inputs => {
            return new Promise(resolve => {
                async.eachSeries(_.uniq(_.map(inputs, i => i.transaction_id)), (transactionID, callback) => {
                    database.applyShards(shardID => database.getRepository('transaction', shardID).resetTransaction(transactionID, 'reset valid transaction spending from invalid transaction'))
                            .then(() => callback());
                }, () => resolve());
            });
        });
    }

    resetValidTransactionSpendingFromDoubleSpendTransaction(transaction) {
        if (!transaction) {
            return Promise.resolve();
        }

        return database.applyShards(sharID => database.getRepository('transaction', sharID).listTransactionInput({
            '+`transaction`.status!'  : 3,
            '+`transaction`.is_stable': 1,
            'output_transaction_id'   : transaction.transaction_id
        })).then(inputs => {
            return new Promise(resolve => {
                async.eachSeries(_.uniq(_.map(inputs, i => i.transaction_id)), (transactionID, callback) => {

                    database.applyShards(sharID => database.getRepository('transaction', sharID).listTransactionOutput({
                        'transaction_output.is_double_spend': 0,
                        'transaction_output.transaction_id' : transactionID
                    })).then(outputs => {
                        if (outputs.length === 0) {
                            return;
                        }

                        return database.applyShards(shardID => database.getRepository('transaction', shardID).resetTransaction(transactionID, 'reset valid transaction spending from double spend transaction'));

                    }).then(() => callback());

                }, () => resolve());
            });
        });
    }

    /**
     * invalidates a transaction the way a consensus that finds it invalid
     * does: stops its consensus round, marks it invalid in every shard, frees
     * the outputs it spent and sends the transactions spending its outputs
     * back to validation.
     * @param transactionID
     * @return {Promise<Object>} the transaction; rejects with
     * consensus_not_ready before initialize() ran (the api starts before the
     * wallet, which initializes the consensus once its sync queues are up),
     * and with transaction_not_found when no shard holds it
     */
    invalidateTransaction(transactionID) {
        if (!this._consensusRoundState) {
            return Promise.reject('consensus_not_ready');
        }

        return database.firstShards(shardID => database.getRepository('transaction', shardID).getTransactionObject(transactionID))
                       .then(transaction => {
                           if (!transaction) {
                               return Promise.reject('transaction_not_found');
                           }

                           const consensusData = this._consensusRoundState[transactionID];
                           if (consensusData) {
                               consensusData.active = false;
                               consensusData.resolve?.();
                           }
                           cache.removeCacheItem('validation', transactionID);
                           this._transactionValidationRejected.add(transactionID);
                           this.deleteTransactionFromCache(transactionID);
                           console.log('[wallet-transaction-consensus-status] invalidate transaction', transactionID, 'on request');

                           return database.applyShards(shardID => {
                               const transactionRepository = database.getRepository('transaction', shardID);
                               return transactionRepository.invalidateTransaction(transactionID)
                                                           .then(() => transactionRepository.clearTransactionObjectCache(transactionID));
                           }).then(() => this.resetInputsSpentByTransaction(transaction))
                                          .then(() => this.resetValidTransactionSpendingFromInvalidTransaction(transaction))
                                          .then(() => {
                                              wallet._checkIfWalletUpdate(new Set(_.map(transaction.transaction_output_list || [], o => o.address_key_identifier)));
                                              wallet.notifyTransactionChanged([transaction], 'transaction_validation:invalid');
                                              return transaction;
                                          });
                       });
    }

    resetInputsSpentByTransaction(transaction) {
        if (!transaction) {
            return Promise.resolve();
        }

        return new Promise(resolve => {
            async.eachSeries(transaction.transaction_input_list, (input, callback) => {
                database.applyShards(sharID => database.getRepository('transaction', sharID).getTransactionOutput({'`transaction`.transaction_id': input.output_transaction_id}))
                        .then(spentTransactionOutput => {
                            if (_.some(spentTransactionOutput, output => output?.status === 3)) {
                                return callback();
                            }

                            return database.applyShards(shardID => {
                                const transactionRepository = database.getRepository('transaction', shardID);
                                return transactionRepository.listTransactionSpendingOutput(input.output_transaction_id, input.output_position);
                            }).then(transactionSpendingOutputList => {
                                let isDoubleSpend = false;
                                for (let transactionSpendingOutput of transactionSpendingOutputList) {
                                    if (transactionSpendingOutput.transaction_id !== transaction.transaction_id &&
                                        transactionSpendingOutput.status !== 3 &&
                                        !this._transactionValidationRejected.has(transactionSpendingOutput.transaction_id) &&
                                        (transactionSpendingOutput.is_stable === 0 || transactionSpendingOutput.is_double_spend === 0)) {
                                        isDoubleSpend = true;
                                        break;
                                    }
                                }

                                if (!isDoubleSpend) {
                                    return database.applyShardZeroAndShardRepository('transaction', input.output_shard_id,
                                        transactionRepository =>
                                            (config.CONSENSUS_VALIDATION_INPUT_TRANSACTION_RESET ?
                                             transactionRepository.resetTransaction(input.output_transaction_id) :
                                             transactionRepository.updateTransactionOutput(input.output_transaction_id, input.output_position, null))
                                                .then(() => transactionRepository.clearTransactionObjectCache(input.output_transaction_id)))
                                                   .then(() => callback())
                                                   .catch(() => callback());
                                }
                                else {
                                    callback();
                                }
                            });
                        });
            }, () => resolve(transaction));
        });
    }

    async doConsensusTransactionValidationWatchDog() {

        if (this._lastTransactionValidatedTimestamp && (Date.now() - this._lastTransactionValidatedTimestamp) >= (config.CONSENSUS_WATCHDOG_WAIT_TIME_MAX * 2)) { // wait at most 2 CONSENSUS_WATCHDOG_WAIT_TIME_MAX without validations before
            for (let [transactionID, consensusData] of Object.entries(this._consensusRoundState)) {
                for (let consensusRoundResponseData of consensusData.consensus_round_response) {
                    for (let [nodeID, consensusNodeResponseData] of Object.entries(consensusRoundResponseData)) {
                        if (!consensusNodeResponseData.response) {
                            console.log(`[wallet-transaction-consensus] ${transactionID} was not validated on node ${nodeID} after ${Math.floor((Date.now() - consensusNodeResponseData.timestamp) / 1000)} seconds`);
                        }
                    }
                }
            }
            console.log(`[wallet-transaction-consensus] restarting network and consensus processes`);
            // reset internal state
            await network.stop();
            setTimeout(async() => {
                await network.initialize();
                this.clearState();
            }, 5000);
            return;
        }

        for (let [transactionID, consensusData] of Object.entries(this._consensusRoundState)) {
            if (this._validationWatchDogState[transactionID]) {
                if ((Date.now() - this._validationWatchDogState[transactionID].timestamp) >= config.CONSENSUS_WATCHDOG_WAIT_TIME_MAX) { // max life is 1.5min
                    console.log('[wallet-transaction-consensus-watchdog] killed by watch dog txid: ', transactionID, ' - consensus round: ', consensusData.consensus_round_count);
                    if (consensusData.is_wallet_transaction) {
                        this._transactionRetryValidation[transactionID] = Date.now() + 60 * 1000; // allow retry in 1min
                    }
                    this._transactionValidationRejected.add(transactionID);
                    consensusData.active = false;
                    consensusData.resolve?.();
                    delete this._consensusRoundState[transactionID];
                    delete this._validationWatchDogState[transactionID];
                    return;
                }
            }
            else {
                this._validationWatchDogState[transactionID] = {timestamp: Date.now() + 60000};
            }

            if (consensusData.active && consensusData.requestPeerValidation && (Date.now() - consensusData.timestamp) >= 15000) {
                for (let i = 0; i <= consensusData.consensus_round_count; i++) {
                    const consensusRoundResponseData = consensusData.consensus_round_response[i];
                    for (let [nodeID, consensusNodeResponseData] of Object.entries(consensusRoundResponseData)) {
                        if (!consensusNodeResponseData.response) {
                            delete consensusRoundResponseData[nodeID];
                        }
                    }
                }
                consensusData.requestPeerValidation();
                consensusData.timestamp = Date.now();
            }
        }

        for (let [nodeID, validationData] of Object.entries(this._transactionValidationState)) {
            if ((Date.now() - validationData.timestamp) >= config.CONSENSUS_VALIDATION_WAIT_TIME_MAX) {
                delete this._transactionValidationState[nodeID];
            }
        }
    }

    _getActiveConsensusRoundTransactionIDs() {
        return _.keys(this._consensusRoundState).filter(transactionID => this._consensusRoundState[transactionID].active);
    }

    getActiveConsensusRoundCount() {
        return this._getActiveConsensusRoundTransactionIDs().length;
    }

    async _selectPendingTransaction(reservations) {
        const consensusRoundState  = this._consensusRoundState;
        let excludeTransactionList = Array.from(this._transactionValidationRejected);
        if (excludeTransactionList.length > 900) { //max sqlite parameters are 999
            excludeTransactionList = _.sample(excludeTransactionList, 900);
        }

        console.log('[wallet-transaction-consensus-status] get wallet unstable transactions');
        let startTime = Date.now();
        let pendingTransactions = await database.applyShards(shardID => {
            return new Promise(resolve => {
                async.mapSeries([
                    wallet.defaultKeyIdentifier,
                    ...config.EXTERNAL_WALLET_KEY_IDENTIFIER
                ], (addressKeyIdentifier, callback) => {
                    database.getRepository('transaction', shardID)
                            .getWalletUnstableTransactions(addressKeyIdentifier, excludeTransactionList)
                            .then(transactions => {
                                console.log(`[wallet-transaction-consensus-validation] ${transactions.length} pending transactions found for ${addressKeyIdentifier} (before filter)`);
                                // filter out recently synced transactions and ones already tracked by consensus
                                const transactionList = _.filter(transactions, transaction => !(Date.now() - transaction.create_date < 30 || consensusRoundState[transaction.transaction_id]));
                                console.log(`[wallet-transaction-consensus-validation] ${transactionList.length} pending transactions can be processed for ${addressKeyIdentifier} (after filter)`);
                                callback(null, transactionList);
                            })
                            .catch(() => callback(null, []));
                }, (err, data) => resolve(Array.prototype.concat.apply([], data)));
            });
        }, 'transaction_date');

        if (reservations !== this._validationReservations) {
            return;
        }

        console.log(`[wallet-transaction-consensus-validation] get wallet unstable transactions took ${Date.now() - startTime}ms and retrieved ${pendingTransactions.length} pending transactions`);
        const isTransactionFundingWallet = pendingTransactions.length > 0;
        if (isTransactionFundingWallet) {
            cache.setCacheItem('wallet-consensus', 'transaction_rejected_updated', true);
        }
        else {
            if (!cache.getCacheItem('wallet-consensus', 'update_transaction_rejected')) {
                cache.setCacheItem('wallet-consensus', 'update_transaction_rejected', false, 60000);
                console.log('[wallet-transaction-consensus-validation] update rejected transaction using output status');
                const unstableTransactionList = await database.applyShards(shardID => {
                    const transactionRepository = database.getRepository('transaction', shardID);
                    return transactionRepository.listTransactionOutput({
                        address_key_identifier        : wallet.defaultKeyIdentifier,
                        is_double_spend               : 0,
                        'transaction_output.is_stable': 0,
                        is_spent                      : 0
                    });
                });
                if (reservations !== this._validationReservations) {
                    return;
                }
                unstableTransactionList.forEach(transaction => this._transactionValidationRejected.delete(transaction.transaction_id));
            }

            console.log('[wallet-transaction-consensus-validation] get all unstable transactions');
            startTime = Date.now();
            const transactions = await database.applyShards(shardID => {
                return database.getRepository('transaction', shardID)
                               .findUnstableTransaction(excludeTransactionList, config.MODE_NODE_VALIDATION_FULL);
            }, 'transaction_date');
            console.log(`[wallet-transaction-consensus-validation] ${transactions.length} pending transactions found (before filter)`);
            pendingTransactions = _.filter(transactions, transaction => !(Date.now() - transaction.create_date < 30 || consensusRoundState[transaction.transaction_id]));
            console.log(`[wallet-transaction-consensus-validation] ${pendingTransactions.length} pending transactions can be processed (after filter)`);
            console.log(`[wallet-transaction-consensus-validation] get unstable transactions took ${Date.now() - startTime}ms and retrieved ${transactions.length} pending transactions`);
        }

        const rejectedCandidates = _.remove(pendingTransactions, transaction => this._transactionValidationRejected.has(transaction.transaction_id) || consensusRoundState[transaction.transaction_id]);
        const pendingTransaction = _.minBy(pendingTransactions, 'transaction_date') || _.minBy(rejectedCandidates, 'transaction_date');
        if (!pendingTransaction || !isTransactionFundingWallet) {
            return [pendingTransaction, isTransactionFundingWallet];
        }

        console.log('[wallet-transaction-consensus-validation] start verification of pending transaction outputs');
        startTime = Date.now();
        const outputs = await database.applyShards(shardID => {
            return database.getRepository('transaction', shardID).getTransactionOutputs(pendingTransaction.transaction_id);
        });
        if (reservations !== this._validationReservations) {
            return;
        }

        const walletOutputs = outputs.filter(output => output.address_key_identifier === wallet.defaultKeyIdentifier);
        if (walletOutputs.length > 0) {
            const processedOutputs = await wallet.updateTransactionOutputWithAddressInformation(walletOutputs);
            if (reservations !== this._validationReservations) {
                return;
            }

            if (processedOutputs.length !== walletOutputs.length) {
                // the wallet cannot process some of this transaction's outputs
                await database.applyShards(shardID => {
                    return database.getRepository('transaction', shardID).invalidateTransaction(pendingTransaction.transaction_id);
                });
                return;
            }
        }

        console.log(`[wallet-transaction-consensus-validation] verification of pending transaction outputs took ${Date.now() - startTime}ms`);
        return [pendingTransaction, isTransactionFundingWallet];
    }

    async doValidateTransaction() {
        if (wallet.isGeneratingWalletAddresses) {
            console.log('[wallet-transaction-consensus-validation] wait for wallet address generation to finish');
            return;
        }

        // A state reset replaces the set and invalidates selections from before the reset.
        const reservations        = this._validationReservations;
        const activeTransactionIDs = this._getActiveConsensusRoundTransactionIDs();
        const limit                = config.CONSENSUS_VALIDATION_PARALLEL_PROCESS_MAX;
        if (activeTransactionIDs.length + reservations.size >= limit) {
            console.log('[wallet-transaction-consensus-validation] validation capacity reached', {
                limit,
                activeTransactionIDs,
                reservations: reservations.size
            });
            return;
        }

        const reservation = Symbol();
        reservations.add(reservation);
        let transactionID;
        let consensusData;
        const prepareConsensusRound = async unlock => {
            try {
                if (reservations !== this._validationReservations) {
                    return;
                }

                const selection = await this._selectPendingTransaction(reservations);
                if (!selection || reservations !== this._validationReservations) {
                    return;
                }

                const [transaction, isTransactionFundingWallet] = selection;
                if (!transaction) {
                    console.log('[wallet-transaction-consensus-validation] no pending funds available for validation.');
                    if (reservations.size === 1 && this.getActiveConsensusRoundCount() === 0) {
                        this._lastTransactionValidatedTimestamp = undefined;
                    }
                    return;
                }

                transactionID = transaction.transaction_id;
                if (this._consensusRoundState[transactionID] || this._transactionRetryValidation[transactionID] > Date.now()) {
                    console.log('[wallet-transaction-consensus-validation] consensus already tracked or retry deferred for transaction', transactionID);
                    return;
                }

                if (!['0a0', '0b0', 'la0l', 'lb0l'].includes(transaction.version)) {
                    transaction.transaction_date = new Date(transaction.transaction_date * 1000);
                }
                else {
                    transaction.transaction_date = new Date(transaction.transaction_date);
                }

                console.log('[wallet-transaction-consensus-status] starting consensus round for ', transactionID);
                this._transactionRetryValidation[transactionID] = Date.now() + 60 * 1000;
                consensusData = {
                    is_wallet_transaction             : isTransactionFundingWallet,
                    consensus_round_validation_count  : 0,
                    consensus_round_invalid_count     : 0,
                    consensus_round_double_spend_count: 0,
                    consensus_round_not_found_count   : 0,
                    consensus_round_count             : 0,
                    consensus_round_response          : [{}],
                    consensus_round_node_discard      : new Set(),
                    timestamp                         : Date.now(),
                    active                            : true
                };
                // Publish the round before releasing the reservation and waking the next selection.
                this._consensusRoundState[transactionID] = consensusData;
                return transaction;
            }
            finally {
                reservations.delete(reservation);
                unlock();
            }
        };

        try {
            const pendingTransaction = await new Promise((resolve, reject) => {
                mutex.lock(['wallet-transaction-consensus-validation'], unlock => {
                    prepareConsensusRound(unlock).then(resolve, reject);
                });
            });

            if (!pendingTransaction || this._consensusRoundState[transactionID] !== consensusData) {
                return;
            }

            if (this._lastTransactionValidatedTimestamp === undefined && !network.hasOutboundConnectionsSlotAvailable()) {
                this._lastTransactionValidatedTimestamp = Date.now();
            }

            await this._startConsensusRound(transactionID);
            if (reservations !== this._validationReservations) {
                return;
            }
            await wallet._checkIfWalletUpdate(new Set(_.map(pendingTransaction.transaction_output_list, output => output.address_key_identifier)));
            if (this._consensusRoundState[transactionID] === consensusData) {
                delete this._validationPrepareState[transactionID];
            }
            setTimeout(() => {
                if (reservations === this._validationReservations) {
                    this.doValidateTransaction();
                }
            }, 0);
        }
        catch {
            reservations.delete(reservation);
        }
        finally {
            if (consensusData && this._consensusRoundState[transactionID] === consensusData) {
                delete this._consensusRoundState[transactionID];
                delete this._validationWatchDogState[transactionID];
            }
        }
    }

}


export default new WalletTransactionConsensus();
