import config from '../config/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Queue from 'better-queue';
import peer from '../../net/peer';
import network from '../../net/network';
import SqliteStore from '../../database/queue-sqlite';
import database from '../../database/database';
import wallet from './wallet';
import async from 'async';
import _ from 'lodash';


export class WalletSync {

    constructor() {
        this.queue                 = null;
        this.transactionSpendQueue = null;
        this.pendingTransactions   = {};
        this.scheduledQueueAdd     = {};
        this.CARGO_MAX_LENGHT      = config.NODE_CONNECTION_OUTBOUND_MAX * 10;
        this.progressiveSync       = {};
    }

    initialize() {
        if (!fs.existsSync(path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER))) {
            fs.mkdirSync(path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER));
        }

        this.queue = new Queue((batch, done) => {
            async.eachSeries(batch, (job, callback) => {
                if (!job.transaction_id) {
                    return callback();
                }

                this.pendingTransactions[job.transaction_id] = true;

                if (job.attempt >= config.TRANSACTION_RETRY_SYNC_MAX) {
                    this.removeTransactionSync(job.transaction_id, {
                        id  : 'transaction_' + job.transaction_id,
                        data: job
                    });
                    return callback();
                }

                database.firstShards((shardID) => {
                    const transactionRepository = database.getRepository('transaction', shardID);
                    return new Promise((resolve, reject) => transactionRepository.hasTransaction(job.transaction_id)
                                                                                 .then(([hasTransaction, isAuditPoint, hasTransactionData]) => hasTransaction || isAuditPoint ? resolve([
                                                                                     hasTransaction,
                                                                                     isAuditPoint,
                                                                                     hasTransactionData,
                                                                                     shardID
                                                                                 ]) : reject())
                                                                                 .catch(() => reject()));
                }).then(data => data || []).then(([hasTransaction]) => {
                    if (hasTransaction || wallet.isProcessingTransaction(job.transaction_id)) {
                        return callback();
                    }

                    this.addSchedule(job.transaction_id, {
                        ...job,
                        dispatch_request: true,
                        queued          : true,
                        attempt         : job.attempt + 1
                    }, config.NETWORK_LONG_TIME_WAIT_MAX * 2);

                    peer.transactionSyncRequest(job.transaction_id, job)
                        .then(() => callback())
                        .catch(() => callback());
                }).catch(() => callback());

            }, () => done());
        }, {
            id                      : 'transaction_id',
            store                   : new SqliteStore({
                dialect     : 'sqlite',
                path        : path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER + config.DATABASE_CONNECTION.FILENAME_TRANSACTION_QUEUE),
                setImmediate: global.setImmediate
            }),
            batchSize               : this.CARGO_MAX_LENGHT,
            precondition            : function(cb) {
                if (network.registeredClients.length > 0) {
                    cb(null, true);
                }
                else {
                    cb(null, false);
                }
            },
            priority                : function(entry, cb) {
                return cb(null, entry.priority || 0);
            },
            setImmediate            : global.setImmediate,
            preconditionRetryTimeout: 10 * 1000 // If we go offline, retry
            // every 10s
        });

        this.transactionSpendQueue = new Queue((batch, done) => {
            console.log('[wallet-sync] transaction spend sync stats ', this.transactionSpendQueue.getStats());
            if (batch.length === 0) {
                return setTimeout(done, config.NETWORK_LONG_TIME_WAIT_MAX * 2);
            }
            async.eachSeries(batch, (job, callback) => {
                if (!job.transaction_output_id) {
                    return callback();
                }
                let [transactionID, outputShardID, outputPosition] = job.transaction_output_id.split('_');
                if (transactionID === undefined || outputShardID === undefined || outputPosition === undefined) {
                    return callback(); //something was wrong skip this output.
                }

                // convert to integer
                try {
                    outputPosition = parseInt(outputPosition);
                }
                catch (e) {
                    return callback(); //something was wrong skip this output.
                }

                database.applyShards(shardID => {
                    const transactionRepository = database.getRepository('transaction', shardID);
                    return transactionRepository.listTransactionInput({
                        output_transaction_id: transactionID,
                        output_shard_id      : outputShardID,
                        output_position      : outputPosition
                    }).then(inputList => {
                        const spendingInputs = [];
                        return new Promise((resolve) => {
                            async.eachSeries(inputList, (input, callbackInput) => {
                                /* check if there is any input that is double spend.
                                 if so, we should force updating this transaction output as spent.
                                 */
                                transactionRepository.listTransactionInput({
                                    'transaction_input.transaction_id': input.transaction_id,
                                    is_double_spend                   : 1
                                }).then(doubleSpendInputList => {
                                    if (doubleSpendInputList.length > 0) {
                                        return callbackInput();
                                    }
                                    return transactionRepository.getTransaction(input.transaction_id)
                                                                .then(transaction => {
                                                                    if (transaction && transaction.status !== 3) {
                                                                        spendingInputs.push(transaction);
                                                                    }
                                                                    callbackInput();
                                                                });
                                });
                            }, () => resolve(spendingInputs));
                        });
                    });
                }).then(spendingTransactionList => {
                    // skip if we already know that the tx is spent
                    if (spendingTransactionList.length > 0) {
                        return database.applyShardZeroAndShardRepository('transaction', outputShardID, transactionRepository => {
                            return transactionRepository.updateTransactionOutput(transactionID, outputPosition, _.min(_.map(spendingTransactionList, spendingInput => spendingInput.transaction_date)));
                        }).then(() => {
                            callback();
                        });
                    }

                    peer.transactionOutputSpendRequest(transactionID, outputPosition)
                        .then(_ => callback())
                        .catch(() => {
                            this.transactionSpendQueue.push({
                                transaction_output_id: job.transaction_output_id
                            });
                            callback();
                        });
                });
            }, () => {
                return setTimeout(done, config.NETWORK_LONG_TIME_WAIT_MAX * 2);
            });
        }, {
            id                      : 'transaction_output_id',
            store                   : new SqliteStore({
                dialect     : 'sqlite',
                path        : path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER + config.DATABASE_CONNECTION.FILENAME_TRANSACTION_SPEND_QUEUE),
                setImmediate: global.setImmediate
            }),
            batchSize               : this.CARGO_MAX_LENGHT,
            precondition            : function(cb) {
                if (network.registeredClients.length > 0) {
                    cb(null, true);
                }
                else {
                    cb(null, false);
                }
            },
            priority                : function(entry, cb) {
                return cb(null, entry.priority || 0);
            },
            setImmediate            : global.setImmediate,
            preconditionRetryTimeout: 10 * 1000 // If we go offline, retry
            // every 10s
        });

        this.unresolvedTransactionQueue = new Queue(() => {
        }, {
            id          : 'id',
            store       : new SqliteStore({
                dialect     : 'sqlite',
                path        : path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER + config.DATABASE_CONNECTION.FILENAME_TRANSACTION_UNRESOLVED_QUEUE),
                setImmediate: global.setImmediate
            }),
            setImmediate: global.setImmediate
        });

        return Promise.resolve();
    }

    syncTransactionSpendingOutputs(transaction) {
        const walletKeyIdentifier = wallet.getKeyIdentifier();
        for (let outputPosition = 0; outputPosition < transaction.transaction_output_list.length; outputPosition++) {
            if (transaction.transaction_output_list[outputPosition].address_key_identifier !== walletKeyIdentifier) {
                continue;
            }
            this.transactionSpendQueue.push({
                transaction_output_id: `${transaction.transaction_id}_${transaction.shard_id}_${outputPosition}`
            });
        }
    }

    doProgressiveSync(ws) {
        if (this.progressiveSync[ws.nodeID]) {
            return;
        }
        this.progressiveSync[ws.nodeID] = {
            ws,
            timestamp: Math.round(Date.now() / 1000)
        };
        this._runProgressiveSync(ws.nodeID);
    }

    _runProgressiveSync(nodeID) {
        const peerSyncInfo = this.progressiveSync[nodeID];
        if (!this.progressiveSync[nodeID]) {
            return;
        }

        const {
                  ws,
                  timestamp
              } = peerSyncInfo;
        if (ws.readyState !== ws.OPEN) {
            return;
        }
        const beginTimestamp = timestamp - config.TRANSACTION_PROGRESSIVE_SYNC_TIMESPAN;
        if (database.getRepository('transaction').isExpired(timestamp)) {
            return;
        }
        // get transactions from shard, filtered by date
        database.applyShards((shardID) => {
            const transactionRepository = database.getRepository('transaction', shardID);
            return transactionRepository.listTransactions({
                transaction_date_end  : timestamp,
                transaction_date_begin: beginTimestamp
            });
        }).then(transactions => new Set(_.map(transactions, transaction => transaction.transaction_id)))
                .then(transactions => peer.transactionSyncByDate(beginTimestamp, timestamp, Array.from(transactions), peerSyncInfo.ws))
                .then((data) => {
                    if (data.transaction_id_list) {
                        data.transaction_id_list.forEach(transactionToSync => this.add(transactionToSync));
                    }
                    this.moveProgressiveSync(ws);
                    setTimeout(() => this._runProgressiveSync(nodeID), config.NETWORK_LONG_TIME_WAIT_MAX * 5);
                })
                .catch((e) => {
                    if (e === 'sync_not_allowed') {
                        return;
                    }
                    setTimeout(() => this._runProgressiveSync(nodeID), config.NETWORK_LONG_TIME_WAIT_MAX * 5);
                });
    }

    moveProgressiveSync(ws) {
        const peerSyncInfo = this.progressiveSync[ws.nodeID];
        if (!peerSyncInfo) {
            return;
        }
        peerSyncInfo.timestamp = peerSyncInfo.timestamp - config.TRANSACTION_PROGRESSIVE_SYNC_TIMESPAN;
    }

    stopProgressiveSync(ws) {
        delete this.progressiveSync[ws.nodeID];
    }

    add(transactionID, options) {
        this.unresolvedTransactionQueue._store.getTask('transaction_' + transactionID, (err, unresolvedTransaction) => {
            const {
                      delay,
                      priority
                  }         = options || {};
            const attempt   = options && options.attempt ? options.attempt + 1 : 1;
            const timestamp = options && options.timestamp ? options.timestamp : Date.now();

            if (unresolvedTransaction && (!unresolvedTransaction.data.transaction_sync_rejected || !(priority > 0 && attempt < config.TRANSACTION_RETRY_SYNC_MAX))) {
                return;
            }
            else if (!this.queue || this.pendingTransactions[transactionID] || wallet.isProcessingTransaction(transactionID)) {
                return;
            }

            if (attempt >= config.TRANSACTION_RETRY_SYNC_MAX || database.getRepository('transaction').isExpired(Math.floor(timestamp / 1000))) {
                this.removeTransactionSync(transactionID, {
                    id  : 'transaction_' + transactionID,
                    data: {
                        transaction_id  : transactionID,
                        dispatch_request: true,
                        priority        : priority === undefined ? -1 : priority,
                        timestamp,
                        attempt
                    }
                });
            }
            else if (delay && delay > 0) {
                this.addSchedule(transactionID, {
                    transaction_id  : transactionID,
                    dispatch_request: true,
                    timestamp,
                    attempt,
                    priority
                }, delay);
            }
            else {
                this.removeSchedule(transactionID);
                this.pendingTransactions[transactionID] = true;
                this.queue.push({
                    transaction_id  : transactionID,
                    dispatch_request: true,
                    timestamp,
                    attempt,
                    priority
                });
            }
        });
    }

    addSchedule(transactionID, data = {}, delay) {
        this.scheduledQueueAdd[transactionID] = setTimeout(() => {
            if (!this.queue || !data.dispatch_request && this.pendingTransactions[transactionID]) {
                return;
            }

            this.pendingTransactions[transactionID] = true;
            delete this.scheduledQueueAdd[transactionID];
            this.queue.push(data);
        }, delay);
    }

    removeSchedule(transactionID) {
        this.scheduledQueueAdd[transactionID] && clearTimeout(this.scheduledQueueAdd[transactionID]);
        delete this.scheduledQueueAdd[transactionID];
    }

    hasPendingTransaction(transactionID) {
        return this.pendingTransactions[transactionID];
    }

    clearTransactionSync(transactionID) {
        this.queue.cancel(transactionID);
        delete this.pendingTransactions[transactionID];
    }

    removeTransactionSync(transactionID, data) {
        this.removeSchedule(transactionID);
        this.clearTransactionSync(transactionID);

        if (!data) {
            data = {
                id  : 'transaction_' + transactionID,
                data: {
                    transaction_id           : transactionID,
                    transaction_sync_rejected: true
                }
            };
        }

        this.unresolvedTransactionQueue.push(data);
    }

    close() {
        return new Promise(resolve => {
            if (this.queue) {
                this.queue.destroy(() => resolve());
            }
            else {
                resolve();
            }
        }).then(() => new Promise(resolve => {
            if (this.transactionSpendQueue) {
                this.transactionSpendQueue.destroy(() => resolve());
            }
            else {
                resolve();
            }
        }));
    }

    getTransactionSyncData(transactionID) {
        return new Promise(resolve => {
            if (!this.queue) {
                return resolve();
            }
            this.queue._store.getTask(transactionID, (_, data) => resolve(data));
        });
    }

    getTransactionData(transactionID) {
        return this.getTransactionSyncData(transactionID)
                   .then((data) => {
                       if (data) {
                           return {
                               type: 'sync',
                               data
                           };
                       }
                       else {
                           return this.getTransactionUnresolvedData(transactionID)
                                      .then(data => {
                                          if (data) {
                                              return {
                                                  type: 'unresolved',
                                                  data
                                              };
                                          }
                                          else {
                                              return null;
                                          }
                                      });
                       }
                   });
    }

    getTransactionUnresolvedData(transactionID) {
        return new Promise(resolve => {
            if (!this.unresolvedTransactionQueue) {
                return resolve();
            }
            this.unresolvedTransactionQueue._store.getTask('transaction_' + transactionID, (_, data) => resolve(data));
        });
    }

    _doSyncTransactionSpend() {
        if (!this.transactionSpendQueue) {
            return Promise.resolve();
        }

        return new Promise(resolve => {
            this.transactionSpendQueue._store.getAll((err, rows) => {
                if (err) {
                    console.error(err);
                    return resolve();
                }
                const queuedTransactionOutputs = new Set(_.map(rows, row => row.id));
                database.applyShards(shardID => {
                    // add all unspent outputs to transaction
                    // spend sync
                    const transactionRepository = database.getRepository('transaction', shardID);
                    return transactionRepository.listTransactionOutput({
                        is_spent               : 0,
                        is_double_spend        : 0,
                        address_key_identifier : wallet.getKeyIdentifier(),
                        '`transaction`.status!': 3
                    }, 'transaction_date')
                                                .then(transactionOutputList => {
                                                    transactionOutputList.forEach(transactionOutput => {
                                                        const transactionOutputID = `${transactionOutput.transaction_id}_${transactionOutput.shard_id}_${transactionOutput.output_position}`;
                                                        if (!queuedTransactionOutputs.has(transactionOutputID)) {
                                                            this.transactionSpendQueue.push({
                                                                transaction_output_id: transactionOutputID,
                                                                priority             : 1
                                                            });
                                                        }
                                                    });
                                                });
                }).then(() => resolve());
            });
        });
    }

}


export default new WalletSync();
