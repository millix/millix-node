import config from '../core/config/config';
import fs from 'fs';
import mutex from '../core/mutex';
import cryptoRandomString from 'crypto-random-string';
import os from 'os';
import wallet from '../core/wallet/wallet';
import console from '../core/console';
import path from 'path';
import async from 'async';
import {Address, API, Config, Job, Keychain, Node, Schema, Shard as ShardRepository, Wallet} from './repositories/repositories';
import Shard from './shard';
import genesisConfig from '../core/genesis/genesis-config';
import _ from 'lodash';


export class Database {
    static ID_CHARACTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    constructor() {
        this.databaseMillix    = null;
        this.databaseJobEngine = null;
        this.repositories      = {};
        this.shards            = {};
        this.shardRepositories = new Set([
            'audit_point',
            'transaction',
            'audit_verification'
        ]);
    }

    static generateID(length) {
        return cryptoRandomString({
            length,
            characters: Database.ID_CHARACTERS
        });
    }

    static buildQuery(sql, where, orderBy, limit, shardID) {
        let parameters = [];
        if (where) {
            _.each(_.keys(where), key => {
                if (where[key] === undefined) {
                    return;
                }

                if (parameters.length > 0) {
                    sql += ' AND ';
                }
                else {
                    sql += ' WHERE ';
                }

                if (key.endsWith('_begin') && key.endsWith('_min')) {
                    sql += `${key.substring(0, key.lastIndexOf('_'))} >= ?`;
                }
                if (key.endsWith('_end') && key.endsWith('_max')) {
                    sql += `${key.substring(0, key.lastIndexOf('_'))} <= ?`;
                }
                else {
                    sql += `${key} = ?`;
                }

                parameters.push(where[key]);
            });
        }

        if (shardID) {
            if (parameters.length === 0) {
                sql += ' WHERE shard_id = ?';
            }
            else {
                sql += ' AND shard_id = ?';
            }
            parameters.push(shardID);
        }

        if (orderBy) {
            sql += ' ORDER BY ' + orderBy;
        }

        if (limit) {
            sql += ' LIMIT ?';
            parameters.push(limit);
        }
        return {
            sql,
            parameters
        };
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
                    fs.readFile(config.DATABASE_CONNECTION.SCRIPT_INIT_MILLIX_JOB_ENGINE, 'utf8', (err, data) => {
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

    _initializeShards() {
        const shardRepository      = new ShardRepository(this.databaseMillix);
        this.repositories['shard'] = shardRepository;
        return shardRepository.listShard()
                              .then((shardList) => {
                                  return new Promise(resolve => {
                                      async.eachSeries(shardList, (shard, callback) => {
                                          const dbShard               = new Shard(shard.schema_path + shard.schema_name, shard.shard_id);
                                          this.shards[shard.shard_id] = dbShard;
                                          dbShard.initialize()
                                                 .then(() => callback());
                                      }, () => resolve());
                                  });
                              });
    }

    _initializeTables() {
        this.repositories['node']     = new Node(this.databaseMillix);
        this.repositories['keychain'] = new Keychain(this.databaseMillix);
        this.repositories['config']   = new Config(this.databaseMillix);
        this.repositories['wallet']   = new Wallet(this.databaseMillix);
        this.repositories['address']  = new Address(this.databaseMillix);
        this.repositories['job']      = new Job(this.databaseJobEngine);
        this.repositories['api']      = new API(this.databaseMillix);

        _.each(_.keys(this.shards), shard => {
            const transactionRepository = this.shards[shard].getRepository('transaction');
            const auditPointRepository  = this.shards[shard].getRepository('audit_point');
            transactionRepository.setAddressRepository(this.repositories['address']);
            transactionRepository.setAuditPointRepository(auditPointRepository);
        });

        return this.repositories['address'].loadAddressVersion();
    }

    getRepository(repositoryName, shardID) {
        if (shardID) {
            return this.shards[shardID].getRepository(repositoryName);
        }
        else if (this.shardRepositories.has(repositoryName)) {
            return this.shards[genesisConfig.genesis_shard_id].getRepository(repositoryName);
        }
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
        console.log('[database] check schema version');
        return new Promise(resolve => {
            schema.getVersion()
                  .then(version => {
                      if (parseInt(version) < parseInt(config.DATABASE_CONNECTION.SCHEMA_VERSION)) {
                          console.log('[database] migrating schema from version', version, ' to version ', config.DATABASE_CONNECTION.SCHEMA_VERSION);
                          schema.migrate(config.DATABASE_CONNECTION.SCHEMA_VERSION, config.DATABASE_CONNECTION.SCRIPT_MIGRATION_DIR)
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
                          schema.migrate(1, config.DATABASE_CONNECTION.SCRIPT_MIGRATION_DIR)
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
                       .then(() => this._initializeShards())
                       .then(() => this._initializeTables());
        }
        return Promise.resolve();
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
