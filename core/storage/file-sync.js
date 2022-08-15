import config from '../config/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Queue from 'better-queue';
import network from '../../net/network';
import SqliteStore from '../../database/queue-sqlite';
import fileExchange from './file-exchange';


export class FileSync {

    constructor() {
        this.queue       = null;
        this.pendingSync = {};
        this.pendingJob  = [];
    }

    initialize() {
        if (!fs.existsSync(config.STORAGE_CONNECTION.FOLDER)) {
            fs.mkdirSync(config.STORAGE_CONNECTION.FOLDER);
        }

        this.queue = new Queue((data, done) => {
            console.log('[file-sync] processing file ', data);
            fileExchange.syncFilesFromTransaction(data.transaction_id, data.address_key_identifier, data.transaction_output_metadata, data.transaction_date)
                        .catch(_ => _)
                        .then(status => {
                            console.log('[file-sync] done processing file ', data);
                            if (status === 'transaction_file_sync_completed') {
                                return done();
                            }
                            setTimeout(() => {
                                done();
                                data.retries++;
                                if (data.retries >= data.options?.max_retries) {
                                    return;
                                }
                                this.queue.push(data);
                            }, 10000);
                        });
        }, {
            id                      : 'transaction_id',
            store                   : new SqliteStore({
                dialect     : 'sqlite',
                path        : path.join(config.STORAGE_CONNECTION.FOLDER, config.STORAGE_CONNECTION.FILENAME_STORAGE_QUEUE),
                setImmediate: global.setImmediate
            }),
            batchSize               : 1,
            precondition            : (cb) => {
                if (this.pendingJob.length > 0) {
                    for (const job of this.pendingJob) {
                        this.queue.push(job);
                    }
                    this.pendingJob = [];
                }

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

    addToPendingSync(transactionId, options = {}) {
        this.pendingSync[transactionId] = {options};
    }

    hasPendingSync(transactionId) {
        return !!this.pendingSync[transactionId];
    }

    getPendingSyncOptions(transactionId) {
        return this.pendingSync[transactionId]?.options;
    }

    removeFromPendingSync(transactionId) {
        delete this.pendingSync[transactionId];
    }

    pushToQueue(data) {
        this.queue.push(data);
    }


    addWithTransaction(transaction, options = {}) {
        this.add(transaction.transaction_id, transaction.transaction_input_list[0].address_key_identifier, transaction.transaction_output_attribute.transaction_output_metadata, Math.floor(new Date(transaction.transaction_date).getTime() / 1000), options);
    }

    add(transactionId, addressKeyIdentifier, transactionOutputMetadata, transactionDate, options = {}) {
        const job = {
            transaction_id             : transactionId,
            address_key_identifier     : addressKeyIdentifier,
            transaction_output_metadata: transactionOutputMetadata,
            transaction_date           : transactionDate,
            timestamp                  : Date.now(),
            priority                   : options?.priority || 0,
            retries                      : 0,
            options
        };

        if (!this.queue._connected) {
            this.pendingJob.push(job);
            return;
        }

        this.queue.push(job);
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


export default new FileSync();
