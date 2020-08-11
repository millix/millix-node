import config from '../config/config';
import genesisConfig from '../genesis/genesis-config';
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
        this.executorQueue = async.queue((job, callback) => {
            if (!job.transaction_id) {
                return callback();
            }
            delete this.pendingTransactions[job.transaction_id];
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
                peer.transactionSyncRequest(job.transaction_id, job)
                    .then(() => callback())
                    .catch(() => callback());
            });
        }, this.CARGO_MAX_LENGHT);
        this.queue         = new Queue((job, done) => {
            if (this.executorQueue.length() < this.CARGO_MAX_LENGHT) {
                this.executorQueue.push(job);
                done();
            }
            else {
                this.executorQueue.push(job, () => done());
            }
        }, {
            id                      : 'transaction_id',
            store                   : new SqliteStore({
                dialect     : 'sqlite',
                path        : path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER + config.DATABASE_CONNECTION.FILENAME_TRANSACTION_QUEUE),
                setImmediate: global.setImmediate
            }),
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

        let isStartTransactionSync = false;
        if (!fs.existsSync(path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER + config.DATABASE_CONNECTION.FILENAME_TRANSACTION_SPEND_QUEUE))) {
            isStartTransactionSync = true;
        }

        this.transactionSpendQueue = new Queue((batch, done) => {
            console.log('[wallet-sync] transaction spend sync stats ', this.transactionSpendQueue.getStats());
            if (batch.length === 0) {
                return setTimeout(done, config.NETWORK_LONG_TIME_WAIT_MAX * 2);
            }
            async.eachSeries(batch, (job, callback) => {
                if (!job.transaction_output_id) {
                    return callback();
                }
                let [transactionID, shardID, outputPosition] = job.transaction_output_id.split('_');
                if (transactionID === undefined || shardID === undefined || outputPosition === undefined) {
                    return callback(); //something was wrong skip this output.
                }

                // convert to integer
                try {
                    outputPosition = parseInt(outputPosition);
                }
                catch (e) {
                    return callback(); //something was wrong skip this output.
                }

                database.firstShardZeroORShardRepository('transaction', shardID, (transactionRepository) => {
                    return new Promise((resolve, reject) => {
                        transactionRepository.getTransactionOutput({transaction_id: transactionID})
                                             .then(output => output ? resolve(output) : reject())
                                             .catch(() => reject());
                    });
                }).then(output => {
                    // skip if we already know that the tx is spent
                    if (output && output.is_spent === 1) {
                        return callback();
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

        if (isStartTransactionSync) {
            this.transactionSpendQueue.push({transaction_output_id: `${genesisConfig.genesis_transaction}_${genesisConfig.genesis_shard_id}_0`}); // output zero of genesis
            this.add(genesisConfig.genesis_transaction);
        }

        return Promise.resolve();
    }

    syncTransactionSpendingOutputs(transaction) {
        for (let outputPosition = 0; outputPosition < transaction.transaction_output_list.length; outputPosition++) {
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

        const {ws, timestamp} = peerSyncInfo;
        if (ws.readyState !== ws.OPEN) {
            return;
        }
        const beginTimestamp = timestamp - config.TRANSACTION_PROGRESSIVE_SYNC_TIMESPAN;
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
        const {delay, priority} = options || {};
        const attempt           = options && options.attempt ? options.attempt + 1 : 1;
        if (!this.queue || this.pendingTransactions[transactionID] || wallet.isProcessingTransaction(transactionID)) {
            return;
        }

        if (attempt >= config.TRANSACTION_RETRY_SYNC_MAX) {
            this.removeSchedule(transactionID);
            this.pendingTransactions[transactionID] = true;
            this.queue.push({
                transaction_id  : transactionID,
                dispatch_request: true,
                priority        : -1,
                attempt
            });
        }
        else if (delay && delay > 0) {
            this.scheduledQueueAdd[transactionID] = setTimeout(() => {
                if (!this.queue || this.pendingTransactions[transactionID]) {
                    return;
                }

                this.pendingTransactions[transactionID] = true;
                delete this.scheduledQueueAdd[transactionID];
                this.queue.push({
                    transaction_id  : transactionID,
                    dispatch_request: true,
                    attempt,
                    priority
                });
            }, delay);
        }
        else {
            this.removeSchedule(transactionID);
            this.pendingTransactions[transactionID] = true;
            this.queue.push({
                transaction_id  : transactionID,
                dispatch_request: true,
                attempt,
                priority
            });
        }
    }

    removeSchedule(transactionID) {
        this.scheduledQueueAdd[transactionID] && clearTimeout(this.scheduledQueueAdd[transactionID]);
        delete this.scheduledQueueAdd[transactionID];
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
                    return transactionRepository.listTransactionOutput({is_spent: 0}, 'transaction_date')
                                                .then(transactionOutputList => {
                                                    transactionOutputList.forEach(transactionOutput => {
                                                        const transactionOutputID = `${transactionOutput.transaction_id}_${transactionOutput.shard_id}_${transactionOutput.output_position}`;
                                                        if (!queuedTransactionOutputs.has(transactionOutputID)) {
                                                            this.transactionSpendQueue.push({
                                                                transaction_output_id: transactionOutputID
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
