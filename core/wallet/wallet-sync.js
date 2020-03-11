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


export class WalletSync {

    constructor() {
        this.queue               = null;
        this.pendingTransactions = {};
        this.scheduledQueueAdd   = {};
    }

    initialize() {
        if (!fs.existsSync(path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER))) {
            fs.mkdirSync(path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER));
        }
        this.queue = new Queue((job, done) => {
            console.log('[wallet-sync] sync queue stats ', this.queue.getStats(), ' transactions to sync');

            delete this.pendingTransactions[job.transaction_id];

            database.getRepository('transaction')
                    .hasTransaction(job.transaction_id)
                    .then(([hasTransaction, isAuditPoint]) => {
                        if (hasTransaction || wallet.isProcessingTransaction(job.transaction_id)) {
                            return done();
                        }

                        peer.transactionSyncRequest(job.transaction_id)
                            .then(() => done())
                            .catch(() => {
                                this.add(job.transaction_id);
                                done();
                            });
                    }).catch(_ => peer.transactionSyncRequest(job.transaction_id)
                                      .then(() => done())
                                      .catch(() => {
                                          this.add(job.transaction_id);
                                          done();
                                      }));
        }, {
            id                      : 'transaction_id',
            store                   : new SqliteStore({
                dialect     : 'sqlite',
                path        : path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER + config.DATABASE_CONNECTION.FILENAME_SYNC_QUEUE),
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
                    transaction_id: transactionID,
                    priority
                });
            }, delay);
        }
        else {
            this.removeSchedule(transactionID);
            this.pendingTransactions[transactionID] = true;
            this.queue.push({
                transaction_id: transactionID,
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
        });
    }

}


export default new WalletSync();
