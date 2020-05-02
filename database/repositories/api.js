import console from '../../core/console';

export default class API {
    constructor(database) {
        this.database = database;
    }

    list() {
        return new Promise(resolve => {
            this.database.all('select * from api', (err, rows) => {
                resolve(rows);
            });
        });
    }

    addAPI(api) {
        return new Promise((resolve) => {
            this.database.run('INSERT INTO api (api_id, name, description, method, version_released, permission, status) VALUES (?,?,?,?,?,?,?)', [
                api.id,
                api.name,
                api.description,
                api.method,
                api.version_released,
                api.permission,
                api.enable
            ], (err) => {
                if (err) {
                    err.message.startsWith('SQLITE_CONSTRAINT') ? console.log(`[database] apis ${api.id} already exits`) : console.error(err.message);
                }
                resolve();
            });
        });
    }

    removeAPI(apiID) {
        return new Promise((resolve, reject) => {
            let sql = 'delete from api where api_id = ?';
            this.database.run(sql, [apiID], (err) => {
                if (err) {
                    return reject(err.message);
                }
                resolve();
            });
        });
    }

}
