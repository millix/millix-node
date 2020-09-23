import database, {Database} from '../database';

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
        let id = database.getRepository('normalization').get(name);
        if (!id) {
            id = Database.generateID(20);
        }

        return new Promise((resolve, reject) => {
            this.database.run('INSERT INTO config (config_id, config_name, value, type) VALUES (?,?,?,?)', [
                id,
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

    updateConfigByID(configID, value) {
        return new Promise((resolve, reject) => {
            this.database.run('UPDATE config SET value=? WHERE config_id=?', [
                configID,
                value
            ], (err, row) => {
                if (err) {
                    return reject(err.message);
                }
                resolve(row);
            });
        });
    }

    list(where, orderBy, limit) {
        return new Promise(resolve => {
            const {sql, parameters} = Database.buildQuery('SELECT * FROM config', where, orderBy, limit);
            this.database.all(sql, parameters, (err, rows) => {
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
