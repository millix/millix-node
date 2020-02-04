import path from 'path';
import os from 'os';
import config, {DATABASE_CONNECTION} from '../../core/config/config';
import fs from 'fs';

export default class Schema {
    constructor(database) {
        this.database = database;
    }

    getVersion() {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT value FROM schema_information WHERE key="version"', (err, row) => {
                if (err) {
                    return reject(err);
                }
                resolve(row.value);
            });
        });
    }

    migrate(version) {
        return new Promise((resolve, reject) => {
            let migrationFile = `${DATABASE_CONNECTION.SCRIPT_MIGRATION_DIR}/schema-update.${version}.sql`;

            fs.readFile(migrationFile, 'utf8', (err, data) => {
                if (err) {
                    return reject(err.message);
                }
                this.database.exec(data, function(err) {
                    if (err) {
                        return reject(err.message);
                    }

                    resolve();
                });
            });
        });
    }
}
