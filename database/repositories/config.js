import {Database} from '../database';

export default class Config {
    constructor(database) {
        this.database = database;
    }

    getConfig(name) {
        return new Promise(resolve => {
            this.database.get('SELECT * FROM config WHERE config_name=?', [name.toLowerCase()], (err, row) => {
                if (row) {
                    row['config_name'] = row['config_name'].toUpperCase();
                }
                resolve(row);
            });
        });
    }

    addConfig(name, value, type) {
        return new Promise((resolve, reject) => {
            this.database.run('INSERT INTO config (config_id, config_name, value, type) VALUES (?,?,?,?)', [
                Database.generateID(20),
                name.toLowerCase(),
                value,
                type
            ], (err, row) => {
                if (err) {
                    reject(row);
                }
                else {
                    resolve(row);
                }
            });
        });
    }

    updateConfig(name, value, type) {
        name = name.toLowerCase();
        return new Promise(resolve => {
            this.database.run('UPDATE config SET value=?' + (type !== undefined ? ', type=?' : '') + ' WHERE config_name=?', [value].concat(type !== undefined ? [
                type,
                name
            ] : [name]), (err, row) => {
                resolve(row);
            });
        });
    }

    getAll() {
        return new Promise(resolve => {
            this.database.all('SELECT * FROM config', (err, rows) => {
                if (rows) {
                    rows.forEach(row => {
                        row['config_name'] = row['config_name'].toUpperCase();
                    });
                }
                resolve(rows);
            });
        });
    }
}
