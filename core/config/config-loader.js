import db from '../../database/database';
import config from './config';
import _ from 'lodash';
import async from 'async';


class _ConfigLoader {
    constructor() {
        this.reservedConfigNameList = new Set([
            'DATABASE_CONNECTION',
            'NODE_MILLIX_VERSION',
            'TRANSACTION_INPUT_MAX',
            'TRANSACTION_OUTPUT_MAX',
            'TRANSACTION_PARENT_MAX',
            'TRANSACTION_SIGNATURE_MAX',
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
            'SHARD_ZERO_NAME'
        ]);
    }

    cleanConfigsFromDatabase() {
        return db.getRepository('config')
                 .deleteAll();
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
