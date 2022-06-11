import fs from 'fs';
import path from 'path';
import os from 'os';
import config from '../../core/config/config';
import Migration from './migration';
import genesisConfig from '../../core/genesis/genesis-config';

export default new (class Migrate extends Migration {

    migrate(db, migrationFile) {
        return new Promise((resolve, reject) => {
            let databaseFile = path.join(config.DATABASE_CONNECTION.FOLDER, config.DATABASE_CONNECTION.FILENAME_MILLIX);
            let shardFolder  = path.join(config.DATABASE_CONNECTION.FOLDER, 'shard/');

            if (!fs.existsSync(shardFolder)) {
                fs.mkdirSync(shardFolder);
            }

            fs.copyFile(databaseFile, shardFolder + genesisConfig.genesis_shard_id + '.sqlite', (err) => {
                if (err) {
                    throw err;
                }
                this.runMigrateScript(db, migrationFile, {
                    shard_id      : genesisConfig.genesis_shard_id,
                    shard_name    : 'genesis',
                    shard_type    : 'protocol',
                    schema_name   : genesisConfig.genesis_shard_id + '.sqlite',
                    schema_path   : shardFolder,
                    node_id_origin: 'mzPPDwP9BJvHXyvdoBSJJsCQViRTtPbcqA',
                    shard_date    : 1579648257,
                    node_signature: '66n8CxBweCDRZWdvrg9caX7ckCh3Bgz5eDsJQtKYDbgVSAnRZMHCp41dnD4P1gvc6fjocFRhxDDWwtNh8JtpDpbE'
                }).then(() => resolve())
                    .catch((e) => reject(e));
            });
        });
    }
});
