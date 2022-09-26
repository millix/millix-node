import fs from 'fs';
import console from '../../core/console';

export default class Migration {
    constructor() {
    }

    runMigrateScript(db, migrationFile, parameters = {}, checkDatabase = false) {
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

                    if (!checkDatabase) {
                        return resolve();
                    }

                    db.serialize(() => {
                        db.run('VACUUM', err => {
                            if (err) {
                                console.log('[database] vacuum error', err);
                            }
                            else {
                                console.log('[database] vacuum success');
                            }
                        });
                        db.run('PRAGMA wal_checkpoint(TRUNCATE)', err => {
                            if (err) {
                                console.log('[database] wal_checkpoint error', err);
                            }
                            else {
                                console.log('[database] wal_checkpoint success');
                            }
                        });
                        db.run('PRAGMA optimize', err => {
                            if (err) {
                                console.log('[database] optimize error', err);
                            }
                            else {
                                console.log('[database] optimize success');
                            }
                            resolve();
                        });
                    });
                });
            });
        });
    }
}
