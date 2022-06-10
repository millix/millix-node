import config, {SHARD_ZERO_NAME} from '../core/config/config';
import genesisConfig from '../core/genesis/genesis-config';
import fs from 'fs';
import mutex from '../core/mutex';
import cryptoRandomString from 'crypto-random-string';
import os from 'os';
import wallet from '../core/wallet/wallet';
import console from '../core/console';
import path from 'path';
import async from 'async';
import {Address, API, Config, Job, Keychain, Node, Normalization, Schema, Shard as ShardRepository, Wallet} from './repositories/repositories';
import Shard from './shard';
import _ from 'lodash';
import eventBus from '../core/event-bus';
import {Pool} from './pool/pool';


export class Database {
    static ID_CHARACTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    constructor() {
        this.databaseMillix     = null;
        this.databaseJobEngine  = null;
        this.databaseRootFolder = null;
        this.repositories       = {};
        this.knownShards        = new Set();
        this.shards             = {};
        this.shardRepositories  = new Set([
            'transaction'
        ]);
    }

    static generateID(length) {
        return cryptoRandomString({
            length,
            characters: Database.ID_CHARACTERS
        });
    }

    getRootFolder() {
        return this.databaseRootFolder;
    }

    static buildQuery(sql, where, orderBy, limit, shardID, offset) {
        let parameters = [];
        if (where) {
            _.each(_.keys(where), key => {
                if (where[key] === undefined ||
                    ((key.endsWith('_begin') || key.endsWith('_min') || key.endsWith('_end') || key.endsWith('_max')) && !where[key]) ||
                    (key.endsWith('_in') && !(where[key] instanceof Array))) {
                    return;
                }

                if (parameters.length > 0) {
                    sql += ' AND ';
                }
                else {
                    sql += ' WHERE ';
                }

                if (key.endsWith('_begin') || key.endsWith('_min')) {
                    sql += `${key.substring(0, key.lastIndexOf('_'))} >= ?`;
                }
                else if (key.endsWith('_end') || key.endsWith('_max')) {
                    sql += `${key.substring(0, key.lastIndexOf('_'))} <= ?`;
                }
                else if (key.endsWith('_in')) {
                    sql += `${key.substring(0, key.lastIndexOf('_'))} IN (${where[key].map(() => '?').join(',')})`;
                    for (let parameter of where[key]) {
                        parameters.push(parameter);
                    }
                    return;
                }
                else {
                    sql += `${key}= ?`;
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

        if (offset) {
            sql += ' OFFSET ?';
            parameters.push(offset);
        }

        return {
            sql,
            parameters
        };
    }

    static buildUpdate(sql, set, where) {
        let parameters = [];
        let first      = true;
        _.each(_.keys(set), key => {
            if (set[key] === undefined) {
                return;
            }

            if (!first) {
                sql += ', ';
            }
            else {
                sql += ' SET ';
                first = false;
            }

            sql += `${key} = ?`;

            parameters.push(set[key]);
        });
        first = true;
        if (where) {
            _.each(_.keys(where), key => {
                if (where[key] === undefined) {
                    return;
                }

                if (!first) {
                    sql += ' AND ';
                }
                else {
                    sql += ' WHERE ';
                    first = false;
                }

                if (key.endsWith('_begin') || key.endsWith('_min')) {
                    sql += `${key.substring(0, key.lastIndexOf('_'))} >= ?`;
                }
                else if (key.endsWith('_end') || key.endsWith('_max')) {
                    sql += `${key.substring(0, key.lastIndexOf('_'))} <= ?`;
                }
                else {
                    sql += `${key} = ?`;
                }

                parameters.push(where[key]);
            });
        }

        return {
            sql,
            parameters
        };
    }

    static enableDebugger(database) {
        database.on('profile', (sql, time) => {
            console.log(`[database] trace performance => ${sql} : ${time}ms`);
        });
        /*const dbAll  = database.all.bind(database);
         database.all = (function(sql, parameters, callback) {
         console.log(`[database] query all start: ${sql}`);
         if (typeof (parameters) === 'function') {
         callback = parameters;
         }
         const startTime = Date.now();
         dbAll(sql, parameters, (err, data) => {
         const timeElapsed = Date.now() - startTime;
         console.log(`[database] query all (run time ${timeElapsed}ms) : ${sql} : ${err}`);
         callback(err, data);
         });
         }).bind(database);

         const dbGet  = database.get.bind(database);
         database.get = (function(sql, parameters, callback) {
         console.log(`[database] query get start: ${sql}`);
         if (typeof (parameters) === 'function') {
         callback = parameters;
         }
         const startTime = Date.now();
         dbGet(sql, parameters, (err, data) => {
         const timeElapsed = Date.now() - startTime;
         console.log(`[database] query get (run time ${timeElapsed}ms): ${sql} : ${err}`);
         callback(err, data);
         });
         }).bind(database);*/
    }

    _initializeMillixSqlite3() {
        this.databaseRootFolder = config.DATABASE_CONNECTION.FOLDER;
        this.databaseMillix     = new Pool(this.databaseRootFolder, config.DATABASE_CONNECTION.FILENAME_MILLIX, config.DATABASE_CONNECTION.SCRIPT_INIT_MILLIX);
        return this.databaseMillix.initialize();
    }

    _initializeJobEngineSqlite3() {
        this.databaseJobEngine = new Pool(this.databaseRootFolder, config.DATABASE_CONNECTION.FILENAME_JOB_ENGINE, config.DATABASE_CONNECTION.SCRIPT_INIT_MILLIX_JOB_ENGINE, 1);
        return this.databaseJobEngine.initialize();
    }

    addShard(shard, updateTables) {
        const dbShard = new Shard(shard.schema_path + shard.schema_name, shard.shard_id);
        return dbShard.initialize()
                      .then(() => {
                          this.shards[shard.shard_id] = dbShard;
                          this.knownShards.add(shard.shard_id);
                          if (updateTables) {
                              const transactionRepository = this.shards[shard.shard_id].getRepository('transaction');
                              transactionRepository.setAddressRepository(this.repositories['address']);
                          }
                      });
    }

    _registerDefaultShards() {
        const shardRepository = new ShardRepository(this.databaseMillix);
        return new Promise(resolve => {
            shardRepository.addShard(genesisConfig.genesis_shard_id, 'genesis', 'protocol', genesisConfig.genesis_shard_id + '.sqlite', path.join(this.databaseRootFolder, 'shard/'), true, 'mzPPDwP9BJvHXyvdoBSJJsCQViRTtPbcqA', 1579648257, '66n8CxBweCDRZWdvrg9caX7ckCh3Bgz5eDsJQtKYDbgVSAnRZMHCp41dnD4P1gvc6fjocFRhxDDWwtNh8JtpDpbE')
                           .then(resolve).catch(resolve);
        });
    }

    _initializeShards() {
        const shardRepository      = new ShardRepository(this.databaseMillix);
        this.repositories['shard'] = shardRepository;
        return shardRepository.listShard()
                              .then((shardList) => {
                                  return new Promise(resolve => {
                                      async.eachSeries(shardList, (shard, callback) => {
                                          if (shard.is_required) {
                                              this.addShard(shard).then(() => callback());
                                          }
                                          else {
                                              this.addKnownShard(shard.shard_id);
                                              callback();
                                          }
                                      }, () => resolve());
                                  });
                              });
    }

    _initializeTables() {
        this.repositories['normalization'] = new Normalization(this.databaseMillix);
        this.repositories['node']          = new Node(this.databaseMillix);
        this.repositories['keychain']      = new Keychain(this.databaseMillix);
        this.repositories['config']        = new Config(this.databaseMillix);
        this.repositories['wallet']        = new Wallet(this.databaseMillix);
        this.repositories['address']       = new Address(this.databaseMillix);
        this.repositories['job']           = new Job(this.databaseJobEngine);
        this.repositories['api']           = new API(this.databaseMillix);

        // initialize shard 0 (root)
        const dbShard            = new Shard();
        dbShard.database         = this.databaseMillix;
        dbShard.database.shardID = SHARD_ZERO_NAME;
        dbShard._initializeTables().then(_ => _);
        this.shards[SHARD_ZERO_NAME] = dbShard;
        this.knownShards.add(SHARD_ZERO_NAME);

        this.repositories['address'].setNormalizationRepository(this.repositories['normalization']);
        this.repositories['keychain'].setNormalizationRepository(this.repositories['normalization']);
        this.repositories['node'].setNormalizationRepository(this.repositories['normalization']);
        _.each(_.keys(this.shards), shard => {
            const transactionRepository = this.shards[shard].getRepository('transaction');
            transactionRepository.setAddressRepository(this.repositories['address']);
            transactionRepository.setNormalizationRepository(this.repositories['normalization']);
        });

        return this.repositories['address'].loadAddressVersion()
                                           .then(() => this.repositories['normalization'].load());
    }

    getShard(shardID) {
        return this.shards[shardID];
    }

    addKnownShard(shardID) {
        this.knownShards.add(shardID);
    }

    shardExists(shardID) {
        return this.knownShards.has(shardID);
    }

    getRepository(repositoryName, shardID) {
        try {
            if (this.shardRepositories.has(repositoryName)) {
                if (shardID) {
                    return this.shards[shardID].getRepository(repositoryName);
                }
                return this.shards[SHARD_ZERO_NAME].getRepository(repositoryName);
            }
            return this.repositories[repositoryName];
        }
        catch (e) {
            console.log('[database] repository not found', repositoryName, shardID);
            return null;
        }
    }

    _firstWithShardZeroRepository(repositoryName, shardID, isShardZeroFirst, func) {
        return new Promise(resolve => {
            async.eachSeries(isShardZeroFirst ? [
                SHARD_ZERO_NAME,
                shardID
            ] : [
                shardID,
                SHARD_ZERO_NAME
            ], (shardID, callback) => {
                const repository = this.getRepository(repositoryName, shardID);
                if (repository) {
                    func(repository)
                        .then((data) => callback(data))
                        .catch(() => callback());
                }
                else {
                    callback();
                }
            }, (data) => resolve(data));
        });
    }

    firstShardZeroORShardRepository(repositoryName, shardID, func) {
        return this._firstWithShardZeroRepository(repositoryName, shardID, true, func);
    }

    firstShardORShardZeroRepository(repositoryName, shardID, func) {
        return this._firstWithShardZeroRepository(repositoryName, shardID, false, func);
    }

    applyShardZeroAndShardRepository(repositoryName, shardID, func) {
        return new Promise(resolve => {
            async.mapSeries([
                SHARD_ZERO_NAME,
                shardID
            ], (shardID, callback) => {
                const repository = this.getRepository(repositoryName, shardID);
                if (repository) {
                    func(repository)
                        .then(result => callback(null, result))
                        .catch(() => callback(null, []));
                }
                else {
                    callback(null, []);
                }
            }, (err, data) => {
                if (data) {
                    data = Array.prototype.concat.apply([], data);
                }
                else {
                    data = [];
                }
                resolve(data);
            });
        });
    }

    applyShards(func, orderBy, limit, shardID) {
        return new Promise(resolve => {
            async.waterfall([
                callback => {
                    if (shardID) {
                        return callback(null, [shardID]);
                    }
                    else {
                        return callback(null, _.keys(this.shards));
                    }
                },
                (shardList, callback) => {
                    async.mapSeries([SHARD_ZERO_NAME].concat(_.without(shardList, SHARD_ZERO_NAME)), (dbShardID, mapCallback) => {
                        func(dbShardID).then(result => mapCallback(null, result)).catch(() => mapCallback(null, []));
                    }, (error, data) => {
                        if (data) {
                            data = Array.prototype.concat.apply([], data);
                        }
                        else {
                            data = [];
                        }

                        if (orderBy) {
                            if (orderBy.trim().split(' ').length === 1) {
                                orderBy += ' asc';
                            }
                            const regExp = /^(?<column>\w+) (?<order>asc|desc)$/.exec(orderBy);
                            if (regExp && regExp.groups && regExp.groups.column && regExp.groups.order) {
                                data = _.orderBy(data, regExp.groups.column, regExp.groups.order);
                            }
                        }

                        if (limit !== undefined) {
                            data = data.slice(0, limit);
                        }

                        callback(null, data);
                    });
                }
            ], (error, data) => {
                resolve(data);
            });
        });
    }

    firstShards(func) {
        return new Promise((resolve) => {
            async.waterfall([
                callback => {
                    return callback(null, _.shuffle(_.keys(this.shards)));
                },
                (shardList, callback) => {
                    async.eachSeries([SHARD_ZERO_NAME].concat(_.without(shardList, SHARD_ZERO_NAME)), (dbShardID, mapCallback) => {
                        func(dbShardID)
                            .then(result => mapCallback(result))
                            .catch(() => mapCallback());
                    }, (data) => callback(data));
                }
            ], (data) => {
                resolve(data);
            });
        });
    }

    runWallCheckpointAll() {
        return new Promise(resolve => {
            async.eachSeries(_.keys(this.shards), (shardID, callback) => {
                Database.runWallCheckpoint(this.shards[shardID].database)
                        .then(callback)
                        .catch(callback);
            }, () => resolve());
        });
    }

    static runWallCheckpoint(db) {
        return new Promise(resolve => {
            mutex.lock(['transaction'], (unlock) => {
                console.log('[database] locking for wal checkpoint');
                db.run('PRAGMA wal_checkpoint(TRUNCATE)', function(err) {
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

    runVacuumAll() {
        return new Promise(resolve => {
            async.eachSeries(_.keys(this.shards), (shardID, callback) => {
                Database.runVacuum(this.shards[shardID].database)
                        .then(callback)
                        .catch(callback);
            }, () => resolve());
        });
    }

    static runVacuum(db) {
        return new Promise(resolve => {
            mutex.lock(['transaction'], (unlock) => {
                console.log('[database] locking for vacuum');
                db.run('VACUUM; PRAGMA wal_checkpoint(TRUNCATE);', function(err) {
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
        let newVersion;
        return new Promise(resolve => {
            schema.getVersion()
                  .then(version => {
                      if (parseInt(version) < parseInt(config.DATABASE_CONNECTION.SCHEMA_VERSION)) {
                          newVersion = parseInt(version) + 1;
                          console.log('[database] migrating schema from version', version, ' to version ', newVersion);
                          eventBus.emit('wallet_notify_message', {
                              message  : `[database] migrating main database from version ${version} to version ${newVersion}`,
                              is_sticky: true,
                              timestamp: Date.now()
                          });
                          return schema.migrate(newVersion, config.DATABASE_CONNECTION.SCRIPT_MIGRATION_DIR)
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
                          console.log('[database] current schema version is ', version);
                          resolve();
                      }
                  })
                  .catch((err) => {
                      if (err.message.indexOf('no such table: schema_information') > -1) {
                          console.log('[database] migrating to version 1');
                          eventBus.emit('wallet_notify_message', {
                              message  : `[database] migrating main database to version 1`,
                              is_sticky: true,
                              timestamp: Date.now()
                          });
                          return schema.migrate(1, config.DATABASE_CONNECTION.SCRIPT_MIGRATION_DIR)
                                       .then(() => this._migrateTables())
                                       .then(() => resolve());
                      }
                      else {
                          eventBus.emit('wallet_notify_message', {
                              message  : `[database] migration error: version ${newVersion}\n(${err.message || err})`,
                              is_sticky: true,
                              timestamp: Date.now()
                          });
                          if (err.message && err.message.startsWith('SQLITE_CORRUPT')) {
                              const dbFile = path.join(this.databaseRootFolder, config.DATABASE_CONNECTION.FILENAME_MILLIX);
                              return Database.deleteCorruptedDatabase(dbFile)
                                             .then(() => this._initializeMillixSqlite3())
                                             .then(() => this._migrateTables());
                          }
                          throw Error('[database] migration ' + err.message);
                      }
                  });
        });
    }

    static deleteCorruptedDatabase(databaseFile) {
        return new Promise(resolve => {
            fs.unlink(databaseFile, err => {
                resolve();
            });
        });
    }

    initialize() {
        if (config.DATABASE_ENGINE === 'sqlite') {
            return this._initializeMillixSqlite3()
                       .then(() => this._registerDefaultShards())
                       .then(() => this._initializeJobEngineSqlite3())
                       .then(() => this._migrateTables())
                       .then(() => this._initializeShards())
                       .then(() => this._initializeTables())
                       .then(() => this.runWallCheckpointAll());
        }
        return Promise.resolve();
    }

    close() {
        return new Promise(resolve => {
            async.waterfall([
                (callback) => {
                    if (this.databaseMillix) {
                        this.databaseMillix.close((err) => {
                            if (err) {
                                console.error(err.message);
                            }
                            console.log('[database] the millix database connection was closed.');
                            callback();
                        });
                    }
                    else {
                        callback();
                    }
                },
                (callback) => {
                    if (this.databaseJobEngine) {
                        this.databaseJobEngine.close((err) => {
                            if (err) {
                                console.error(err.message);
                            }
                            console.log('[database] job engine database connection was closed.');
                            callback();
                        });
                    }
                    else {
                        callback();
                    }
                },
                (callback) => {
                    async.eachSeries(_.keys(this.shards), (shardID, callback) => {
                        if (this.shards[shardID]) {
                            this.shards[shardID].close().then(() => callback());
                        }
                        else {
                            callback();
                        }
                    }, () => {
                        callback();
                    });
                }
            ], () => resolve());
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
            }, () => {
                async.eachSeries(_.keys(this.shards), (shardID, callback) => {
                    if (this.shards[shardID].checkup) {
                        this.shards[shardID].checkup().then(() => callback());
                    }
                    else {
                        callback();
                    }
                }, () => {
                    resolve();
                });
            });
        });
    }
}


export default new Database();
