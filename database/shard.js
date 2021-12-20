import fs from 'fs';
import config from '../core/config/config';
import console from '../core/console';
import {Schema, Transaction} from './repositories/repositories';
import path from 'path';
import {Database} from './database';
import eventBus from '../core/event-bus';
import os from 'os';
import async from 'async';
import _ from 'lodash';

export default class Shard {
    constructor(databaseFile, shardID) {
        this.databaseFile = databaseFile;
        this.shardID      = shardID;
        this.repositories = {};
    }

    initialize() {
        if (config.DATABASE_ENGINE === 'sqlite') {
            return this._initializeMillixShardSqlite3()
                       .then(() => this._attachShardZero())
                       .then(() => this._migrateTables())
                       .then(() => this._initializeTables());
        }
        return Promise.resolve();
    }

    _initializeTables() {
        this.repositories['transaction'] = new Transaction(this.database);
        return Promise.resolve();
    }

    getRepository(repositoryName) {
        return this.repositories[repositoryName];
    }

    _migrateTables() {
        const schema                = new Schema(this.database);
        this.repositories['schema'] = schema;
        console.log('[shard] check schema version');
        let newVersion;
        return new Promise(resolve => {
            schema.getVersion()
                  .then(version => {
                      if (parseInt(version) < parseInt(config.DATABASE_CONNECTION.SCHEMA_VERSION)) {
                          newVersion = parseInt(version) + 1;
                          console.log('[shard] migrating schema from version', version, ' to version ', newVersion);
                          eventBus.emit('wallet_notify_message', {
                              message  : `[database] migrating shard ${this.shardID} from version ${version} to version ${newVersion}`,
                              is_sticky: true,
                              timestamp: Date.now()
                          });
                          return schema.migrate(newVersion, config.DATABASE_CONNECTION.SCRIPT_MIGRATION_SHARD_DIR)
                                       .then(() => {
                                           eventBus.emit('wallet_notify_message', {
                                               message  : `[database] migration completed: version ${newVersion}`,
                                               is_sticky: false,
                                               timestamp: Date.now()
                                           });
                                       })
                                       .then(() => this._migrateTables())
                                       .then(() => resolve());
                      }
                      else {
                          console.log('[shard] current schema version is ', version);
                          resolve();
                      }
                  })
                  .catch((err) => {
                      eventBus.emit('wallet_notify_message', {
                          message  : `[database] shard ${this.shardID} migration error: version ${newVersion}\n(${err.message || err})`,
                          is_sticky: true,
                          timestamp: Date.now()
                      });
                      throw Error('[shard] migration ' + err.message);
                  });
        });
    }

    _attachShardZero() {
        return new Promise((resolve, reject) => {
            const databaseRootFolder = path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER);
            const shardZeroDBPath    = path.join(databaseRootFolder, config.DATABASE_CONNECTION.FILENAME_MILLIX);
            this.database.exec(`ATTACH DATABASE '${shardZeroDBPath}' AS shard_zero`, (err) => {
                if (err) {
                    return reject(err);
                }
                return resolve();
            });
        });
    }

    _initializeMillixShardSqlite3() {
        return new Promise(resolve => {
            const sqlite3                       = require('sqlite3');
            sqlite3.Database.prototype.runAsync = function(sql, ...params) {
                return new Promise((resolve, reject) => {
                    this.run(sql, params, function(err) {
                        if (err) {
                            return reject(err);
                        }
                        resolve(this);
                    });
                });
            };

            let shardFolder = path.dirname(this.databaseFile);
            if (!fs.existsSync(shardFolder)) {
                fs.mkdirSync(shardFolder);
            }

            let doInitialize = false;
            if (!fs.existsSync(this.databaseFile)) {
                doInitialize = true;
            }

            this.database = new sqlite3.Database(this.databaseFile, (err) => {
                if (err) {
                    throw Error(err.message);
                }

                console.log('[shard] connected to the shard database: ', this.shardID);

                config.MODE_DEBUG && Database.enableDebugger(this.database);

                if (doInitialize) {
                    console.log('[shard] initializing database');
                    fs.readFile(config.DATABASE_CONNECTION.SCRIPT_INIT_MILLIX_SHARD, 'utf8', (err, data) => {
                        if (err) {
                            throw Error(err.message);
                        }
                        this.database.exec(data, (err) => {
                            if (err) {
                                throw Error(err.message);
                            }
                            console.log('[shard] database initialized');
                            this.database.shardID = this.shardID;
                            this.database.run('PRAGMA journal_mode = WAL', () => this.database.run('PRAGMA synchronous = NORMAL', () => resolve()));
                        });
                    });
                }
                else {
                    this.database.run('PRAGMA journal_mode = WAL', () => this.database.run('PRAGMA synchronous = NORMAL', () => resolve()));
                }
            });
        });
    }

    checkup() {
        return new Promise(resolve => {
            async.eachSeries(_.keys(this.repositories), (repositoryName, callback) => {
                if (this.repositories[repositoryName].checkup) {
                    this.repositories[repositoryName].checkup().then(() => callback());
                }
                else {
                    callback();
                }
            }, () => resolve());
        });
    }

}
