import db from '../../database/database';
import config from './config';
import _ from 'lodash';
import async from 'async';


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
            const re = new RegExp('(?<major>\\d+)\\.(?<minor>\\d+)\\.(?<patch>\\d+)');
            let major, minor, patch;
            if (oldVersion) {
                const match = re.exec(oldVersion);
                if (match && match.groups &&
                    match.groups.major && match.groups.minor && match.groups.patch) {
                    major = parseInt(match.groups.major);
                    minor = parseInt(match.groups.minor);
                    patch = parseInt(match.groups.patch);
                }
            }

            if (!oldVersion || (major === 1 && minor <= 17 && patch <= 5)) {
                /* apply to all version <= 1.17.5 */
                async.eachSeries(db.shards, (shard, callback) => {
                    shard.database.exec(`
                        update transaction_input
                        set status = 1
                        where transaction_id in (select transaction_id from 'transaction'
                        where status = 3
                          and create_date
                            > strftime('%s'
                            , 'now'
                            , '-90 days'));
                        update transaction_output
                        set is_stable   = 0,
                            stable_date = NULL,
                            status      = 1
                        where transaction_id in (select transaction_id from 'transaction'
                        where status = 3
                          and create_date
                            > strftime('%s'
                            , 'now'
                            , '-90 days'));
                        update 'transaction'
                        set is_stable = 0, stable_date = NULL, status = 1
                        where transaction_id in (select transaction_id from 'transaction' where status = 3
                          and create_date
                            > strftime('%s'
                            , 'now'
                            , '-90 days'));
                        update transaction_input
                        set status = 3
                        where transaction_id =
                              '2Q72mpGptbz2YdGYh4DPvTV8PTP5CNXgyqPoN1Uf5KKzCqVLUp';
                        update transaction_output
                        set is_stable   = 1,
                            stable_date = CAST(strftime('%s', 'now') AS INTEGER),
                            status      = 3
                        where transaction_id =
                              '2Q72mpGptbz2YdGYh4DPvTV8PTP5CNXgyqPoN1Uf5KKzCqVLUp';
                        update 'transaction'
                        set is_stable = 1, stable_date = CAST(strftime('%s', 'now') AS INTEGER), status = 3
                        where transaction_id = '2Q72mpGptbz2YdGYh4DPvTV8PTP5CNXgyqPoN1Uf5KKzCqVLUp';
                    `, err => {
                        if (err) {
                            console.log('[config-loader] could not apply database patch on version update', err);
                        }
                        callback();
                    });
                }, () => resolve());
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
            }, () => resolve(dbConfigs));
        });
    }
}


export default new _ConfigLoader();
