import {DATABASE_CONNECTION} from '../../core/config/config';
import Migration from '../../scripts/migration/migration';
import {Database} from '../database';

export default class Schema {
    constructor(database) {
        this.database    = database;
        this.baseMigrate = new Migration();
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

    get(where) {
        const {sql, parameters} = Database.buildQuery('SELECT * FROM schema_information', where);
        return new Promise((resolve, reject) => {
            this.database.get(sql, parameters, (err, rows) => {
                if (err) {
                    return reject(err);
                }
                resolve(rows);
            });
        });
    }

    migrate(version, migrationDir) {

        let migrationSQLFile = `${migrationDir}/schema-update-${version}.sql`;
        try {
            let module;
            if (migrationDir.endsWith('shard')) {
                module = require('../../scripts/migration/shard/schema-update-' + version + '.js');
            }
            else {
                module = require('../../scripts/migration/schema-update-' + version + '.js');
            }
            return module.default.migrate(this.database, migrationSQLFile);
        }
        catch (e) {
            return this.baseMigrate.runMigrateScript(this.database, migrationSQLFile);
        }

    }
}
