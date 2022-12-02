import db from '../../database/database';
import config, {SHARD_ZERO_NAME} from './config';
import _ from 'lodash';
import async from 'async';
import path from 'path';
import os from 'os';
import {NodeVersion} from '../utils/utils';


class _ConfigLoader {
    constructor() {
        this.reservedConfigNameList = new Set([
            'DATABASE_CONNECTION',
            'STORAGE_CONNECTION',
            'NODE_MILLIX_VERSION',
            'TRANSACTION_INPUT_MAX',
            'TRANSACTION_OUTPUT_MAX',
            'TRANSACTION_PARENT_MAX',
            'TRANSACTION_SIGNATURE_MAX',
            'DEBUG_LOG_FILTER',
            'FORCE_QUEUE_UPDATE',
            'MODE_NODE_VALIDATION_FULL',
            'NETWORK_LONG_TIME_WAIT_MAX',
            'NETWORK_SHORT_TIME_WAIT_MAX',
            'TRANSACTION_TIME_LIMIT_PROXY',
            'TRANSACTION_CLOCK_SKEW_TOLERANCE',
            'TRANSACTION_OUTPUT_REFRESH_OLDER_THAN',
            'TRANSACTION_OUTPUT_EXPIRE_OLDER_THAN',
            'WALLET_TRANSACTION_DEFAULT_VERSION',
            'WALLET_TRANSACTION_REFRESH_VERSION',
            'WALLET_TRANSACTION_SUPPORTED_VERSION',
            'WALLET_AGGREGATION_TRANSACTION_MAX',
            'WALLET_AGGREGATION_TRANSACTION_OUTPUT_COUNT',
            'WALLET_AGGREGATION_TRANSACTION_INPUT_COUNT',
            'WALLET_AGGREGATION_CONSUME_SMALLER_FIRST',
            'BRIDGE_ADDRESS',
            'EXTERNAL_API_NOTIFICATION',
            'JOB_CONFIG_VERSION',
            'NODE_PUBLIC',
            'NODE_DNS_SERVER',
            'MODE_STORAGE_SYNC',
            'SHARD_ZERO_NAME'
        ]);
    }

    cleanConfigsFromDatabase() {
        return db.getRepository('config')
                 .deleteAll();
    }

    _onMillixVersionUpgrade(oldVersion, newVersion) {
        return new Promise(resolve => {
            const oldNodeVersion = NodeVersion.fromString(oldVersion);
            const targetVersion  = new NodeVersion(1, 22, 0);
            if (!oldNodeVersion || oldNodeVersion.compareTo(targetVersion) <= 0) {
                if (!oldVersion || config.MODE_TEST_NETWORK) {
                    return resolve();
                }
                /* apply to all version <= 1.22.0 */
                db.applyShards(shardID => {
                    return new Promise(resolve => {
                        let sql;
                        if (shardID === SHARD_ZERO_NAME) {
                            sql = `
                                update 'transaction'
                                set is_stable = 0, stable_date = NULL, status = 1;
                                update 'transaction_output'
                                set is_stable = 0, stable_date= NULL, status = 1,
                                    is_spent = 0, spent_date = NULL, is_double_spend = 0, double_spend_date = NULL;
                                update 'transaction_input'
                                set status = 1, is_double_spend = 0, double_spend_date = NULL;
                                update 'transaction_signature'
                                set status = 1;
                                update 'transaction_parent'
                                set status = 1;
                                update 'transaction_output_attribute'
                                set status = 1;
                            `;
                        }
                        else {
                            sql = `
                                update 'transaction'
                                set is_stable = 0, stable_date = NULL, status = 1
                                where create_date >= 1667001600;
                                update 'transaction_output'
                                set is_stable = 0, stable_date = NULL, status = 1,
                                    is_spent = 0, spent_date = NULL, is_double_spend = 0, double_spend_date = NULL
                                where create_date >= 1667001600;
                                update 'transaction_input'
                                set status = 1, is_double_spend = 0, double_spend_date = NULL
                                where create_date >= 1667001600;
                                update 'transaction_signature'
                                set status = 1
                                where create_date >= 1667001600;
                                update 'transaction_parent'
                                set status = 1
                                where create_date >= 1667001600;
                                update 'transaction_output_attribute'
                                set status = 1
                                where create_date >= 1667001600;
                            `;
                        }
                        console.log('[config-loader] reset transactions on shard', shardID);
                        db.getShard(shardID).database.exec(sql, (err) => {
                            if (err) {
                                console.log('[config-loader] error', err);
                            }
                            console.log('[config-loader] reset done - success:', !err);
                            resolve();
                        });
                    });
                }).then(() => resolve());
            }
            else {
                resolve();
            }
        });
    }

    updateMillixVersion(version) {
        return db.getRepository('config')
                 .getConfig('NODE_MILLIX_VERSION')
                 .then(data => {
                     const oldVersion = data?.value;
                     if (!data || oldVersion !== version) {
                         return this._onMillixVersionUpgrade(oldVersion, version)
                                    .then(() => {
                                        const configRepository = db.getRepository('config');
                                        return configRepository.addConfig('NODE_MILLIX_VERSION', version, 'string')
                                                               .catch(() => configRepository.updateConfig('NODE_MILLIX_VERSION', version, 'string'));
                                    });
                     }
                 })
                 .catch(() => Promise.resolve());
    }

    load(overwriteDefaultConfigsFromDatabase = true) {
        return new Promise(resolve => {
            let dbConfigs = {
                config: {},
                type  : {}
            };
            async.eachSeries(_.keys(config), (configName, callback) => {
                if (configName === 'default' || this.reservedConfigNameList.has(configName)) {
                    dbConfigs.config[configName] = config[configName];
                    dbConfigs.type[configName]   = 'object';

                    if (configName === 'NODE_MILLIX_VERSION') {
                        return this.updateMillixVersion(config['NODE_MILLIX_VERSION'])
                                   .then(() => callback());
                    }

                    callback();
                }
                else {
                    db.getRepository('config')
                      .getConfig(configName)
                      .then(data => {
                          if (data) {
                              let value;
                              switch (data.type) {
                                  case 'string':
                                      value = data.value;
                                      break;
                                  default:
                                      value = JSON.parse(data.value);
                              }
                              if (overwriteDefaultConfigsFromDatabase) {
                                  config[configName] = value;
                              }

                              dbConfigs.config[configName] = value;
                              dbConfigs.type[configName]   = data.type;
                              callback();
                          }
                          else {
                              let value = config[configName];
                              let type  = typeof value;

                              dbConfigs.config[configName] = value;
                              dbConfigs.type[configName]   = type;

                              if (type !== 'string') {
                                  value = JSON.stringify(value);
                              }

                              db.getRepository('config')
                                .addConfig(configName, value, type)
                                .then(() => callback())
                                .catch(() => callback());
                          }
                      });
                }
            }, () => {
                if (overwriteDefaultConfigsFromDatabase) {
                    const dataFolder                             = path.isAbsolute(config.DATABASE_CONNECTION.FOLDER) ? config.DATABASE_CONNECTION.FOLDER : path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER);
                    config.STORAGE_CONNECTION.FOLDER             = path.join(dataFolder, '/storage/');
                    config.STORAGE_CONNECTION.PENDING_TO_SEND    = path.join(dataFolder, '/storage/sending.log');
                    config.STORAGE_CONNECTION.PENDING_TO_RECEIVE = path.join(dataFolder, '/storage/receiving.log');
                    config.DATABASE_CONNECTION.FOLDER            = dataFolder;

                    config.WALLET_KEY_PATH                        = path.join(dataFolder, 'millix_private_key.json');
                    dbConfigs.config['WALLET_KEY_PATH']           = config.WALLET_KEY_PATH;
                    config.NODE_KEY_PATH                          = path.join(dataFolder, 'node.json');
                    dbConfigs.config['NODE_KEY_PATH']             = config.NODE_KEY_PATH;
                    config.NODE_CERTIFICATE_KEY_PATH              = path.join(dataFolder, 'node_certificate_key.pem');
                    dbConfigs.config['NODE_CERTIFICATE_KEY_PATH'] = config.NODE_CERTIFICATE_KEY_PATH;
                    config.NODE_CERTIFICATE_PATH                  = path.join(dataFolder, 'node_certificate.pem');
                    dbConfigs.config['NODE_CERTIFICATE_PATH']     = config.NODE_CERTIFICATE_PATH;
                    config.JOB_CONFIG_PATH                        = path.join(dataFolder, 'job.json');
                    dbConfigs.config['JOB_CONFIG_PATH']           = config.JOB_CONFIG_PATH;
                }
                resolve(dbConfigs);
            });
        });
    }
}


export default new _ConfigLoader();
