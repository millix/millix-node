import fs from 'fs';

export default class Migration {
    constructor() {
    }

    runMigrateScript(db, migrationFile, parameters = {}) {
        return new Promise((resolve, reject) => {
            fs.readFile(migrationFile, 'utf8', (err, data) => {
                if (err) {
                    return reject(err);
                }
                data = data.replace(/\?\w+/g, (m) => {
                    let key = m.substring(1);
                    return parameters.hasOwnProperty(key) ? parameters[key] : '';
                });

                db.exec(data, function(err) {
                    if (err) {
                        return reject(err);
                    }
                    resolve();
                });
            });
        });
    }
}
