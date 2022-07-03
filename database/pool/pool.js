import {Worker} from 'worker_threads';
import os from 'os';
import async from 'async';


export class Pool {
    static WORKER_MAX = 32;

    constructor(databaseFolder, databaseName, initScriptFile, size) {
        this.initialized    = false;
        this.closed         = false;
        this.databaseFolder = databaseFolder;
        this.databaseName   = databaseName;
        this.initScriptFile = initScriptFile;
        this.workerList     = [];
        this.queue          = [];
        this.size           = size || Math.min(os.cpus().length, Pool.WORKER_MAX);
    }

    drainQueue() {
        for (const worker of this.workerList) {
            worker.takeWork();
        }
    }

    initialize() {
        if (this.initialized) {
            return Promise.resolve();
        }
        this.initialized = true;
        return this._spawnAllWorkers()
                   .then(() => new Promise((resolve, reject) => {
                       async.eachSeries(this.workerList, (worker, callback) => {
                           this._sendJobToWorker(worker, 'init', {
                               database_folder : this.databaseFolder,
                               database_name   : this.databaseName,
                               init_script_file: this.initScriptFile
                           }).then(() => callback()).catch(err => callback(err));
                       }, err => err ? reject(err) : resolve());
                   }));
    }

    _spawnAllWorkers() {
        return new Promise((resolve, reject) => {
            /*
             Spawn workers that try to drain the queue.
             */
            async.timesSeries(this.size, (i, callback) => {
                this._createWorker()
                    .then(() => callback())
                    .catch(err => callback(err));
            }, err => err ? reject(err) : resolve());
        });
    }

    _getParameterAndCallback(...parameters) {
        if (parameters.length === 1) {
            return {
                callback  : parameters[0],
                parameters: undefined
            };
        }
        else {
            return {
                callback  : parameters[1],
                parameters: parameters[0]
            };
        }
    }

    _execOnAllWorkers(type, sql, ...data) {
        const {
                  callback,
                  parameters
              } = this._getParameterAndCallback(...data);

        if (this.initialized === false || this.closed === true) {
            return callback({
                error  : 'database_closed',
                message: 'database closed'
            });
        }

        if (type !== 'run' && type !== 'exec') {
            return callback({error: 'invalid_execution_type'});
        }

        async.eachSeries(this.workerList, (worker, eachCallback) => {
            this._sendJobToWorker(worker, type, {
                sql,
                parameters
            })
                .then((result) => eachCallback())
                .catch(err => eachCallback(err));
        }, err => callback(err));
    }

    _execSQL(type, sql, ...data) {
        const {
                  callback,
                  parameters
              } = this._getParameterAndCallback(...data);

        if (this.initialized === false || this.closed === true) {
            return callback({
                error  : 'database_closed',
                message: 'database closed'
            });
        }
        this._addJob(type, {
            sql,
            parameters
        }).then(result => callback(result.err, result.data)).catch(callback);
    }

    all(sql, ...parameters) {
        this._execSQL('all', sql, ...parameters);
    }

    get(sql, ...parameters) {
        this._execSQL('get', sql, ...parameters);
    }

    run(sql, ...parameters) {
        if (sql.toUpperCase().startsWith('ATTACH')) {
            this._execOnAllWorkers('run', sql, ...parameters);
        }
        else {
            this._execSQL('run', sql, ...parameters);
        }
    }

    exec(sql, ...parameters) {
        if (sql.toUpperCase().startsWith('ATTACH')) {
            this._execOnAllWorkers('exec', sql, ...parameters);
        }
        else {
            this._execSQL('exec', sql, ...parameters);
        }
    }

    serialize(callback) {
        callback();
    }

    close(callback) {
        this.closed = true;
        async.eachSeries(this.workerList, (worker, eachCallback) => {
            this._sendJobToWorker(worker, 'close', {})
                .then(() => eachCallback())
                .catch(err => eachCallback(err));
        }, err => callback(err));
    }

    _addJob(type, data) {
        return new Promise((resolve, reject) => {
            this.queue.push({
                resolve,
                reject,
                message: {
                    type,
                    data
                }
            });
            this.drainQueue();
        });
    }

    _sendJobToWorker(worker, type, data) {
        return new Promise((resolve, reject) => {
            worker.priorityWork.push({
                resolve,
                reject,
                message: {
                    type,
                    data
                }
            });
            if (!worker.job) {
                worker.takeWork();
            }
        });
    }

    _createWorker() {
        return new Promise((resolve) => {
            const worker = new Worker('./database/pool/worker.mjs');

            let error = null; // Error that caused the worker to crash

            worker.priorityWork = [];
            worker.takeWork     = () => {
                if (!worker.job && (worker.priorityWork.length > 0 || this.queue.length)) {
                    // If there's a job in the queue, send it to the worker
                    worker.job = worker.priorityWork.shift() || this.queue.shift();
                    worker.postMessage(worker.job.message);
                }
            };

            worker
                .on('online', () => {
                    this.workerList.push(worker);
                    worker.takeWork();
                    resolve();
                })
                .on('message', (result) => {
                    worker.job.resolve(result);
                    worker.job = null;
                    worker.takeWork(); // Check if there's more work to do
                })
                .on('error', (err) => {
                    console.log('[pool-worker] error', err);
                    error = err;
                })
                .on('exit', (code) => {
                    this.workerList = this.workerList.filter(w => w !== worker);
                    if (worker.job) {
                        worker.job.reject(error || new Error('worker died'));
                    }
                    if (code !== 0) {
                        console.log(`[pool-worker] worker exited with code ${code}`);
                        // Worker died, so spawn a new one
                        this._createWorker().then(_ => _);
                    }
                });
        });
    }
}

