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
        this.queue = null;
    }

    initialize() {
        if (!fs.existsSync(config.STORAGE_CONNECTION.FOLDER)) {
            fs.mkdirSync(config.STORAGE_CONNECTION.FOLDER);
        }

        this.queue = new Queue((data, done) => {
            fileExchange.syncFilesFromTransaction(data.transaction_id, data.address_key_identifier, data.transaction_output_metadata, data.transaction_date)
                        .catch(_ => _)
                        .then(status => {
                            if (status === 'transaction_file_sync_completed') {
                                return done();
                            }
                            setTimeout(() => {
                                done();
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

    pushToQueue(data) {
        this.queue.push(data);
    }


    add(transaction) {
        this.queue.push({
            transaction_id             : transaction.transaction_id,
            address_key_identifier     : transaction.transaction_input_list[0].address_key_identifier,
            transaction_output_metadata: transaction.transaction_output_attribute.transaction_output_metadata,
            transaction_date           : Math.floor(new Date(transaction.transaction_date).getTime() / 1000),
            timestamp                  : Date.now()
        });
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
