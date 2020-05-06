import fs from 'fs';
import config from '../core/config/config';
import console from '../core/console';
import {AuditPoint, AuditVerification, Schema, Transaction} from './repositories/repositories';

export default class Shard {
    constructor(databaseFile, shardID) {
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
                          console.log('[shard] migrating schema from version', version, ' to version ', config.DATABASE_CONNECTION.SCHEMA_VERSION);
                          schema.migrate(config.DATABASE_CONNECTION.SCHEMA_VERSION, config.DATABASE_CONNECTION.SCRIPT_MIGRATION_SHARD_DIR)
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
            const sqlite3 = require('sqlite3');

            let doInitialize = false;
            if (!fs.existsSync(this.databaseFile)) {
                doInitialize = true;
            }

            this.database = new sqlite3.Database(this.databaseFile, (err) => {
                if (err) {
                    throw Error(err.message);
                }

                console.log('[shard] connected to the shard database: ', this.shardID);

                if (doInitialize) {
                    console.log('[shard] initializing database');
                    fs.readFile(config.DATABASE_CONNECTION.SCRIPT_INIT_MILLIX_SHARD, 'utf8', (err, data) => {
                        if (err) {
                            throw Error(err.message);
                        }
                        this.database.exec(data, function(err) {
                            if (err) {
                                throw Error(err.message);
                            }
                            console.log('[shard] database initialized');
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
