import fs from 'fs';
import config, {SHARD_ZERO_NAME} from '../core/config/config';
import console from '../core/console';
import {AuditPoint, AuditVerification, Schema, Transaction} from './repositories/repositories';
import path from 'path';
import os from 'os';
import {Database} from './database';

export default class Shard {
    constructor(databaseFile, shardID) {
        this.debug        = false;
        this.databaseFile = databaseFile;
        this.shardID      = shardID;
        this.repositories = {};
    }

    initialize() {
        if (config.DATABASE_ENGINE === 'sqlite') {
            return this._initializeMillixShardSqlite3()
                       .then(() => this._migrateTables())
                       .then(() => this._initializeTables());
        }
        return Promise.resolve();
    }

    _initializeTables() {
        this.repositories['audit_point']        = new AuditPoint(this.database);
        this.repositories['transaction']        = new Transaction(this.database);
        this.repositories['audit_verification'] = new AuditVerification(this.database);
        return Promise.resolve();
    }

    getRepository(repositoryName) {
        return this.repositories[repositoryName];
    }

    _migrateTables() {
        const schema                = new Schema(this.database);
        this.repositories['schema'] = schema;
        console.log('[shard] check schema version');
        return new Promise(resolve => {
            schema.getVersion()
                  .then(version => {
                      if (parseInt(version) < parseInt(config.DATABASE_CONNECTION.SCHEMA_VERSION)) {
                          const newVersion = parseInt(version) + 1;
                          console.log('[shard] migrating schema from version', version, ' to version ', newVersion);
                          schema.migrate(newVersion, config.DATABASE_CONNECTION.SCRIPT_MIGRATION_SHARD_DIR)
                                .then(() => this._migrateTables())
                                .then(() => resolve());
                      }
                      else {
                          console.log('[shard] current schema version is ', version);
                          resolve();
                      }
                  })
                  .catch((err) => {
                      throw Error('[shard] migration' + err.message);
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

                this.debug && Database.enableDebugger(this.database);

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

}
