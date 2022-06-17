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
import eventBus from '../event-bus';


export class WalletSync {

    constructor() {
        this.queue                       = null;
        this.transactionSpendQueue       = null;
        this.transactionSpendWalletQueue = null;
        this.pendingTransactions         = {};
        this.scheduledQueueAdd           = {};
        this.CARGO_MAX_LENGHT            = config.NODE_CONNECTION_OUTBOUND_MAX * 10;
    }

    initialize() {
        if (!fs.existsSync(config.DATABASE_CONNECTION.FOLDER)) {
            fs.mkdirSync(config.DATABASE_CONNECTION.FOLDER);
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
                                                                                 .then(hasTransaction => hasTransaction ? resolve(hasTransaction) : reject()));
                }).then(hasTransaction => {
                    if (!(hasTransaction && wallet.isProcessingTransaction(job.transaction_id))) {
                        return peer.transactionSyncRequest(job.transaction_id, job);
                    }
                })
                        .then(() => callback())
                        .catch(() => {
                            this.addSchedule(job.transaction_id, {
                                ...job,
                                dispatch_request: true,
                                queued          : true,
                                attempt         : job.attempt + 1
                            }, config.NETWORK_LONG_TIME_WAIT_MAX * 2);
                            callback();
                        });

            }, () => done());
        }, {
            id                      : 'transaction_id',
            store                   : new SqliteStore({
                dialect     : 'sqlite',
                path        : path.join(config.DATABASE_CONNECTION.FOLDER, config.DATABASE_CONNECTION.FILENAME_TRANSACTION_QUEUE),
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

        this.transactionSpendWalletQueue = new Queue((batch, done) => {
            console.log('[wallet-sync] wallet transaction output spend sync stats ', this.transactionSpendWalletQueue.getStats());
            if (batch.length === 0) {
                return setTimeout(done, config.NETWORK_LONG_TIME_WAIT_MAX * 2);
            }

            const transactionOutputToSyncList = [];
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
                    return transactionRepository.listTransactionSpendingOutput({
                        output_transaction_id: transactionID,
                        output_position      : outputPosition
                    }).then(transactionSpendingOutputList => {
                        let spendingTransaction = undefined;
                        for (let transactionSpendingOutput of transactionSpendingOutputList) {
                            if (transactionSpendingOutput.status !== 3 && (transactionSpendingOutput.is_stable === 0 || transactionSpendingOutput.is_double_spend === 0)) {
                                spendingTransaction = spendingTransaction === undefined ? spendingTransaction : _.minBy([
                                    spendingTransaction,
                                    transactionSpendingOutput
                                ], t => t.transaction_date.getTime());
                            }
                        }
                        return !!spendingTransaction ? [spendingTransaction] : [];
                    });
                }).then(spendingTransactionList => {
                    // skip if we already know that the tx is spent
                    if (spendingTransactionList.length > 0) {
                        return database.applyShardZeroAndShardRepository('transaction', outputShardID, transactionRepository => {
                            return transactionRepository.updateTransactionOutput(transactionID, outputPosition, _.minBy(spendingTransactionList, t => t.transaction_date.getTime()));
                        }).then(() => {
                            callback();
                        });
                    }

                    transactionOutputToSyncList.push({
                        transaction_id       : transactionID,
                        output_position      : outputPosition,
                        transaction_output_id: job.transaction_output_id
                    });
                    callback();
                });
            }, () => {
                const transactionOutputToQueue = [];
                async.eachSeries(transactionOutputToSyncList, (transactionOutput, callback) => {
                    peer.transactionOutputSpendRequest(transactionOutput.transaction_id, transactionOutput.output_position)
                        .then(data => _.each(data.transaction_list, transaction => eventBus.emit('transaction_new', transaction)))
                        .catch(_ => _)
                        .then(() => {
                            transactionOutputToQueue.push({
                                transaction_output_id: transactionOutput.transaction_output_id
                            });
                            callback();
                        });
                }, () => {
                    return setTimeout(() => {
                        done();
                        transactionOutputToQueue.forEach(output => this.transactionSpendWalletQueue.push(output));
                    }, config.NETWORK_LONG_TIME_WAIT_MAX * 2);
                });
            });
        }, {
            id                      : 'transaction_output_id',
            store                   : new SqliteStore({
                clear       : true,
                dialect     : 'sqlite',
                path        : path.join(config.DATABASE_CONNECTION.FOLDER, config.DATABASE_CONNECTION.FILENAME_TRANSACTION_SPEND_WALLET_QUEUE),
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
            console.log('[wallet-sync] transaction output spend sync stats ', this.transactionSpendQueue.getStats());
            if (batch.length === 0) {
                return setTimeout(done, config.NETWORK_LONG_TIME_WAIT_MAX * 2);
            }
            const transactionOutputToSyncList = [];
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
                    return transactionRepository.listTransactionSpendingOutput({
                        output_transaction_id: transactionID,
                        output_position      : outputPosition
                    }).then(transactionSpendingOutputList => {
                        let spendingTransaction = undefined;
                        for (let transactionSpendingOutput of transactionSpendingOutputList) {
                            if (transactionSpendingOutput.status !== 3 && (transactionSpendingOutput.is_stable === 0 || transactionSpendingOutput.is_double_spend === 0)) {
                                spendingTransaction = spendingTransaction === undefined ? spendingTransaction : _.minBy([
                                    spendingTransaction,
                                    transactionSpendingOutput
                                ], t => t.transaction_date.getTime());
                            }
                        }
                        return !!spendingTransaction ? [spendingTransaction] : [];
                    });
                }).then(spendingTransactionList => {
                    // skip if we already know that the tx is spent
                    if (spendingTransactionList.length > 0) {
                        return database.applyShardZeroAndShardRepository('transaction', outputShardID, transactionRepository => {
                            return transactionRepository.updateTransactionOutput(transactionID, outputPosition, _.minBy(spendingTransactionList, t => t.transaction_date.getTime()));
                        }).then(() => {
                            callback();
                        });
                    }

                    transactionOutputToSyncList.push({
                        transaction_id       : transactionID,
                        output_position      : outputPosition,
                        transaction_output_id: job.transaction_output_id
                    });
                    callback();
                });
            }, () => {
                const transactionOutputToQueue = [];
                async.eachSeries(transactionOutputToSyncList, (transactionOutput, callback) => {
                    peer.transactionOutputSpendRequest(transactionOutput.transaction_id, transactionOutput.output_position, true)
                        .then(_ => callback())
                        .catch(() => {
                            transactionOutputToQueue.push({
                                transaction_output_id: transactionOutput.transaction_output_id
                            });
                            callback();
                        });
                }, () => {
                    return setTimeout(() => {
                        done();
                        transactionOutputToQueue.forEach(output => this.transactionSpendQueue.push(output));
                    }, config.NETWORK_LONG_TIME_WAIT_MAX * 2);
                });
            });
        }, {
            id                      : 'transaction_output_id',
            store                   : new SqliteStore({
                clear       : true,
                dialect     : 'sqlite',
                path        : path.join(config.DATABASE_CONNECTION.FOLDER, config.DATABASE_CONNECTION.FILENAME_TRANSACTION_SPEND_QUEUE),
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
                path        : path.join(config.DATABASE_CONNECTION.FOLDER, config.DATABASE_CONNECTION.FILENAME_TRANSACTION_UNRESOLVED_QUEUE),
                setImmediate: global.setImmediate
            }),
            setImmediate: global.setImmediate
        });

        return database.applyShards(shardID => {
            return database.getRepository('transaction', shardID)
                           .getMissingInputTransactions();
        }).then(transactions => { /*add the missing inputs to the sync queue*/
            transactions.forEach(transaction => this.add(transaction.transaction_id));
        }).then(() => this.updateSyncTransactionSpend());
    }

    syncTransactionSpendingOutputs(transaction, isModeFullSync) {
        const walletKeyIdentifierSet = new Set([
            wallet.getKeyIdentifier(),
            ...config.EXTERNAL_WALLET_KEY_IDENTIFIER
        ]);
        for (let outputPosition = 0; outputPosition < transaction.transaction_output_list.length; outputPosition++) {
            const transactionOutput = transaction.transaction_output_list[outputPosition];
            if (walletKeyIdentifierSet.has(transactionOutput.address_key_identifier)) {
                this.transactionSpendWalletQueue.push({
                    transaction_output_id: `${transaction.transaction_id}_${transaction.shard_id}_${transactionOutput.output_position}`
                });
            }
            else if (isModeFullSync) {
                this.transactionSpendQueue.push({
                    transaction_output_id: `${transaction.transaction_id}_${transaction.shard_id}_${transactionOutput.output_position}`
                });
            }
        }
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

            if (attempt >= config.TRANSACTION_RETRY_SYNC_MAX) {
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
            if (this.transactionSpendWalletQueue) {
                this.transactionSpendWalletQueue.destroy(() => resolve());
            }
            else {
                resolve();
            }
        })).then(() => new Promise(resolve => {
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

    updateSyncWalletTransactionSpend() {
        return database.applyShards(shardID => {
            // add all unspent outputs to transaction
            // spend sync
            const transactionRepository = database.getRepository('transaction', shardID);
            return transactionRepository.listTransactionOutput({
                address_key_identifier        : wallet.defaultKeyIdentifier,
                is_spent                      : 0,
                is_double_spend               : 0,
                'transaction_output.is_stable': 1,
                '`transaction`.status!'       : 3
            }, 'transaction_date')
                                        .then(transactionOutputList => {
                                            transactionOutputList.forEach(transactionOutput => {
                                                this.transactionSpendWalletQueue.push({transaction_output_id: `${transactionOutput.transaction_id}_${transactionOutput.shard_id}_${transactionOutput.output_position}`});
                                            });
                                        });
        });
    }

    updateSyncTransactionSpend() {
        if (!this.transactionSpendWalletQueue || !this.transactionSpendQueue) {
            return Promise.resolve();
        }

        if (!config.FORCE_QUEUE_UPDATE) {
            return this.updateSyncWalletTransactionSpend(); /* only update walllet transactions */
        }

        const walletKeyIdentifierSet = new Set([
            wallet.getKeyIdentifier(),
            ...config.EXTERNAL_WALLET_KEY_IDENTIFIER
        ]);

        return database.applyShards(shardID => {
            // add all unspent outputs to transaction
            // spend sync
            const transactionRepository = database.getRepository('transaction', shardID);
            return transactionRepository.listTransactionOutput({
                is_spent               : 0,
                is_double_spend        : 0,
                '`transaction`.status!': 3
            }, 'transaction_date')
                                        .then(transactionOutputList => {
                                            transactionOutputList.forEach(transactionOutput => {
                                                const transactionOutputID = `${transactionOutput.transaction_id}_${transactionOutput.shard_id}_${transactionOutput.output_position}`;
                                                if (walletKeyIdentifierSet.has(transactionOutput.address_key_identifier)) {
                                                    this.transactionSpendWalletQueue.push({
                                                        transaction_output_id: transactionOutputID
                                                    });
                                                }
                                                else {
                                                    this.transactionSpendQueue.push({
                                                        transaction_output_id: transactionOutputID
                                                    });
                                                }
                                            });
                                        });
        });
    }

}


export default new WalletSync();
