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


export class WalletSync {

    constructor() {
        this.queue                 = null;
        this.transactionSpendQueue = null;
        this.pendingTransactions   = {};
        this.scheduledQueueAdd     = {};
        this.CARGO_MAX_LENGHT      = config.NODE_CONNECTION_OUTBOUND_MAX * 2;
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
        this.processTransactionSpend = null;
        this.transactionSpendQueue   = new Queue((batch, done) => {
            console.log('[wallet-sync] transaction spend sync stats ', this.transactionSpendQueue.getStats());
            if (batch.length === 0) {
                return done();
            }
            this.processTransactionSpend = new Promise(resolve => {
                async.eachSeries(batch, (job, callback) => {
                    if (!job.transaction_id) {
                        return callback();
                    }

                    peer.transactionSpendRequest(job.transaction_id)
                        .then(response => {
                            if (response.transaction_id_list.length > 0) {
                                response.transaction_id_list.forEach(transactionID => {
                                    this.transactionSpendQueue.push({
                                        transaction_id: transactionID
                                    });
                                });
                                this.add(job.transaction_id);
                            }
                            else {
                                this.transactionSpendQueue.push({
                                    transaction_id: job.transaction_id
                                });
                            }
                            callback();
                        })
                        .catch(() => {
                            this.transactionSpendQueue.push({
                                transaction_id: job.transaction_id
                            });
                            callback();
                        });
                }, () => {
                    done();
                    resolve();
                });
            });
        }, {
            id                      : 'transaction_id',
            store                   : new SqliteStore({
                dialect     : 'sqlite',
                path        : path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER + config.DATABASE_CONNECTION.FILENAME_TRANSACTION_SPEND_QUEUE),
                setImmediate: global.setImmediate
            }),
            batchSize               : 10,
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
            this.transactionSpendQueue.push({transaction_id: genesisConfig.genesis_transaction});
        }

        return Promise.resolve();
    }

    add(transactionID, options) {
        const {delay, priority} = options || {};

        if (!this.queue || this.pendingTransactions[transactionID] || wallet.isProcessingTransaction(transactionID)) {
            return;
        }

        if (delay && delay > 0) {
            this.scheduledQueueAdd[transactionID] = setTimeout(() => {
                if (this.pendingTransactions[transactionID]) {
                    return;
                }

                this.pendingTransactions[transactionID] = true;
                delete this.scheduledQueueAdd[transactionID];
                this.queue.push({
                    transaction_id  : transactionID,
                    dispatch_request: true,
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
        if (!this.transactionSpendQueue || !this.processTransactionSpend) {
            return Promise.resolve();
        }

        return this.processTransactionSpend();
    }

}


export default new WalletSync();
