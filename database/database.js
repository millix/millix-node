import config from '../core/config/config';
import fs from 'fs';
import mutex from '../core/mutex';
import cryptoRandomString from 'crypto-random-string';
import os from 'os';
import wallet from '../core/wallet/wallet';
import console from '../core/console';
import path from 'path';
import {
    Address, AuditPoint, AuditVerification, Config, Keychain, Node,
    Transaction, Wallet, Schema, Job
} from './repositories/repositories';


export class Database {
    static ID_CHARACTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    constructor() {
        this.databaseMillix    = null;
        this.databaseJobEngine = null;
        this.repositories      = {};
    }

    static generateID(length) {
        return cryptoRandomString({
            length,
            characters: Database.ID_CHARACTERS
        });
    }

    _initializeMillixSqlite3() {
        return new Promise(resolve => {
            const sqlite3 = require('sqlite3');

            if (!fs.existsSync(path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER))) {
                fs.mkdirSync(path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER));
            }

            let dbFile = path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER + config.DATABASE_CONNECTION.FILENAME_MILLIX);

            let doInitialize = false;
            if (!fs.existsSync(dbFile)) {
                doInitialize = true;
            }

            this.databaseMillix = new sqlite3.Database(dbFile, (err) => {
                if (err) {
                    throw Error(err.message);
                }

                console.log('Connected to the millix database.');

                if (doInitialize) {
                    console.log('Initializing database');
                    fs.readFile(config.DATABASE_CONNECTION.SCRIPT_INIT_MILLIX, 'utf8', (err, data) => {
                        if (err) {
                            throw Error(err.message);
                        }
                        this.databaseMillix.exec(data, function(err) {
                            if (err) {
                                return console.log(err.message);
                            }
                            console.log('Database initialized');

                            resolve();
                        });
                    });
                }
                else {
                    resolve();
                }

            });
        });
    }

    _initializeJobEngineSqlite3() {
        return new Promise(resolve => {
            const sqlite3 = require('sqlite3');

            if (!fs.existsSync(path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER))) {
                fs.mkdirSync(path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER));
            }

            let dbFile = path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER + config.DATABASE_CONNECTION.FILENAME_JOB_ENGINE);

            let doInitialize = false;
            if (!fs.existsSync(dbFile)) {
                doInitialize = true;
            }

            this.databaseJobEngine = new sqlite3.Database(dbFile, (err) => {
                if (err) {
                    throw Error(err.message);
                }

                console.log('Connected to the job engine database.');

                if (doInitialize) {
                    console.log('Initializing database');
                    fs.readFile(config.DATABASE_CONNECTION.SCRIPT_INIT_JOB_ENGINE, 'utf8', (err, data) => {
                        if (err) {
                            throw Error(err.message);
                        }
                        this.databaseJobEngine.exec(data, function(err) {
                            if (err) {
                                return console.log(err.message);
                            }
                            console.log('Database initialized');

                            resolve();
                        });
                    });
                }
                else {
                    resolve();
                }

            });
        });
    }

    _initializeTables() {
        this.repositories['node']               = new Node(this.databaseMillix);
        this.repositories['keychain']           = new Keychain(this.databaseMillix);
        this.repositories['config']             = new Config(this.databaseMillix);
        this.repositories['audit_point']        = new AuditPoint(this.databaseMillix);
        this.repositories['wallet']             = new Wallet(this.databaseMillix);
        this.repositories['transaction']        = new Transaction(this.databaseMillix);
        this.repositories['address']            = new Address(this.databaseMillix);
        this.repositories['audit_verification'] = new AuditVerification(this.databaseMillix);
        this.repositories['job']                = new Job(this.databaseJobEngine);

        this.repositories['address'].setTransactionRepository(this.repositories['transaction']);
        this.repositories['transaction'].setAddressRepository(this.repositories['address']);
        this.repositories['transaction'].setAuditPointRepository(this.repositories['audit-point']);

        return this.repositories['address'].loadAddressVersion();
    }

    getRepository(repositoryName) {
        return this.repositories[repositoryName];
    }

    runWallCheckpoint() {
        return new Promise(resolve => {
            mutex.lock(['transaction'], (unlock) => {
                console.log('[database] locking for wal checkpoint');
                this.databaseMillix.run('PRAGMA wal_checkpoint(TRUNCATE)', function(err) {
                    if (err) {
                        console.log('[database] wal checkpoint error', err);
                    }
                    else {
                        console.log('[database] wal checkpoint success');
                    }
                    unlock();
                    resolve();
                });
            });
        });
    }

    runVacuum() {
        return new Promise(resolve => {
            mutex.lock(['transaction'], (unlock) => {
                console.log('[database] locking for vacuum');
                this.databaseMillix.run('VACUUM; PRAGMA wal_checkpoint(TRUNCATE);', function(err) {
                    if (err) {
                        console.log('[database] vacuum error', err);
                    }
                    else {
                        console.log('[database] vacuum success');
                    }
                    unlock();
                    resolve();
                });
            });
        });
    }

    _migrateTables() {
        const schema                = new Schema(this.databaseMillix);
        this.repositories['schema'] = schema;
        console.log('[database] check schema versions');
        return new Promise(resolve => {
            schema.getVersion()
                  .then(version => {
                      if (parseInt(version) < parseInt(config.DATABASE_CONNECTION.SCHEMA_VERSION)) {
                          console.log('[database] migrating schema from version', version, ' to version ', config.DATABASE_CONNECTION.SCHEMA_VERSION);
                          schema.migrate(config.DATABASE_CONNECTION.SCHEMA_VERSION)
                                .then(() => this._migrateTables())
                                .then(() => resolve());
                      }
                      else {
                          console.log('[database] current schema version is ', version);
                          resolve();
                      }
                  })
                  .catch((err) => {
                      if (err.message.indexOf('no such table') > -1) {
                          console.log('[database] migrating to version 1');
                          schema.migrate(1)
                                .then(() => this._migrateTables())
                                .then(() => resolve());
                      }
                  });
        });
    }

    initialize() {
        if (config.DATABASE_ENGINE === 'sqlite') {
            return this._initializeMillixSqlite3()
                       .then(() => this._initializeJobEngineSqlite3())
                       .then(() => this._migrateTables())
                       .then(() => this._initializeTables());
        }
    }

    close() {
        this.databaseMillix && this.databaseMillix.close((err) => {
            if (err) {
                console.error(err.message);
            }
            console.log('Close the millix database connection.');
        });

        this.databaseJobEngine && this.databaseJobEngine.close((err) => {
            if (err) {
                console.error(err.message);
            }
            console.log('Close the job engine database connection.');
        });
    }
}


export default new Database();
