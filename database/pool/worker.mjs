import {parentPort} from 'worker_threads';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

let database;

function initializeDB(databaseRootFolder, databaseName, initializeScriptFile) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(databaseRootFolder)) {
            fs.mkdirSync(path.join(databaseRootFolder));
        }

        let dbFile = path.join(databaseRootFolder, databaseName);

        let doInitialize = false;
        if (!fs.existsSync(dbFile)) {
            doInitialize = true;
        }

        database = new sqlite3.Database(dbFile, (err) => {
            if (err) {
                return reject(`${err.message} - ${dbFile}`);
            }

            if (doInitialize) {
                fs.readFile(initializeScriptFile, 'utf8', (err, data) => {
                    if (err) {
                        return reject(`${err.message} - ${dbFile}`);
                    }

                    database.exec(data, (err) => {
                        if (err) {
                            return reject(`${err.message} - ${dbFile}`);
                        }
                        database.run('PRAGMA journal_mode = WAL', () => database.run('PRAGMA synchronous = NORMAL', () => resolve()));
                    });
                });
            } else {
                database.run('PRAGMA journal_mode = WAL', () => database.run('PRAGMA synchronous = NORMAL', () => resolve()));
            }
        });
    });
}

parentPort.on('message', ({
                              type,
                              data
                          }) => {

    if (type === 'init') {
        initializeDB(data.database_folder, data.database_name, data.init_script_file)
                .then(() => parentPort.postMessage({
                    type: 'init_response',
                    initialized: true
                }))
                .catch(e => {
                    throw Error(e)
                });
    } else if (type === 'close') {
        database.close(() => {
            parentPort.postMessage({type: 'close_response', closed: true});
            setImmediate(() => process.exit(0))
        })
    } else if (type === 'all' || type === 'get' || type === 'run') {
        const {
            sql,
            parameters
        } = data;
        database[type](sql, parameters, (err, data) => {
            parentPort.postMessage({err, data});
        });
    } else if (type === 'exec') {
        const {
            sql
        } = data;
        database.exec(sql, (err, data) => {
            parentPort.postMessage({err, data});
        });
    } else {
        throw Error('execution type not supported');
    }
});
