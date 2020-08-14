import {Database} from '../database';
import _ from 'lodash';
import console from '../../core/console';

export default class Job {
    constructor(database) {
        this.database = database;
    }

    getObject(object) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT * FROM object WHERE object_name = ?',
                [
                    object
                ], (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(row);
                });
        });
    }

    addObject(name, options) {
        return new Promise((resolve, reject) => {
            const keys   = _.keys(options);
            const values = _.values(options);

            this.database.run('INSERT INTO `object` (object_id, object_name' + (keys.length > 0 ? ',' + keys.join(',') : '') + ') VALUES (?,?' + Array(values.length + 1).join(',?') + ')',
                [
                    Database.generateID(20),
                    name
                ].concat(values), (err) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve();
                });

        });
    }

    getJobObject(jobID, objectID) {
        return new Promise((resolve, reject) => {
            this.database.run('SELECT * FROM job_object WHERE job_id = ? AND object_id = ?',
                [
                    jobID,
                    objectID
                ], (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(row);
                });

        });
    }

    addJobObject(jobID, objectID) {
        return new Promise((resolve, reject) => {
            this.database.run('INSERT INTO job_object (job_object_id, job_id, object_id) VALUES (?,?,?)',
                [
                    Database.generateID(20),
                    jobID,
                    objectID
                ], (err) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve();
                });

        });
    }

    lockJobObject(jobID) {
        return new Promise((resolve, reject) => {
            this.database.get('UPDATE job_object SET locked = 1 WHERE  job_id = ?',
                [
                    jobID
                ], (err) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve();
                });
        });
    }

    unlockJobObject(jobID) {
        return new Promise((resolve, reject) => {
            this.database.get('UPDATE job_object SET locked = 0 WHERE  job_id = ?',
                [
                    jobID
                ], (err) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve();
                });
        });
    }

    addJobType(type) {
        return new Promise((resolve, reject) => {
            const typeID = Database.generateID(20);
            this.database.run('INSERT INTO job_type (job_type_id, job_type) VALUES (?,?)',
                [
                    typeID,
                    type
                ], (err) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(typeID);
                });
        });
    }

    getJobTypeID(type) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT job_type_id FROM job_type WHERE job_type = ?',
                [
                    type
                ], (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(row);
                });
        });
    }

    addJobGroup(group) {
        return new Promise((resolve, reject) => {
            const groupID = Database.generateID(20);
            this.database.run('INSERT INTO job_group (job_group_id, job_group_name) VALUES (?,?)',
                [
                    groupID,
                    group
                ], (err) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(groupID);
                });
        });
    }

    getJobGroup(group) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT job_group_id FROM job_group WHERE job_group_name = ?',
                [
                    group
                ], (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(row);
                });
        });
    }

    addJobProcessor(ipAddress, port, user, password) {
        return new Promise((resolve, reject) => {
            let processorID = Database.generateID(20);
            this.database.run('INSERT INTO job_processor (processor_id, ip_address, port, rpc_user, rpc_password) VALUES (?,?,?,?,?)',
                [
                    processorID,
                    ipAddress,
                    port,
                    user,
                    password
                ], (err) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(processorID);
                });
        });
    }

    getJobProcessor(ipAddress) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT * FROM job_processor WHERE ip_address = ?',
                [
                    ipAddress
                ], (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    else if (!row) {
                        return reject();
                    }
                    resolve(row);
                });
        });
    }

    getJobs() {
        return new Promise((resolve) => {
            this.database.all('SELECT * FROM job', (err, rows) => {
                resolve(rows || []);
            });
        });
    }

    getJob(name) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT * FROM job WHERE job_name = ?',
                [
                    name
                ], (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    else if (!row) {
                        return reject();
                    }
                    resolve(row);
                });
        });
    }

    addJob(name, processorID, groupID, typeID, payload, priority, options) {
        return new Promise((resolve, reject) => {
            const keys   = _.keys(options);
            const values = _.values(options);

            this.database.run('INSERT INTO job (job_id, job_name, processor_id, job_group_id, job_type_id, job_payload, priority' + (keys.length > 0 ? ',' + keys.join(',') : '') + ') VALUES (?,?,?,?,?,?,?' + Array(values.length + 1).join(',?') + ')',
                [
                    Database.generateID(20),
                    name,
                    processorID,
                    groupID,
                    typeID,
                    payload,
                    priority
                ].concat(values), (err) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve();
                });

        });
    }

    getJobReadyToRun(processorID) {
        return new Promise(resolve => {
            this.database.all('SELECT * FROM job WHERE status = 1 AND in_progress = 0 AND processor_id = ? ' +
                              'AND job_id NOT IN (SELECT DISTINCT b.job_id FROM job_object a INNER JOIN job_object b ON a.object_id = b.object_id WHERE a.locked = 1) ' +
                              'ORDER BY priority DESC',
                [processorID], (err, rows) => {
                    resolve(rows || []);
                });
        });
    }

    updateJobProgressStatus(jobID, inProgress, options) {
        return new Promise((resolve, reject) => {
            const keys   = _.keys(options);
            const values = _.values(options);
            this.database.run('UPDATE job SET in_progress = ?' + (keys.length > 0 ? ',' + keys.join(' = ?,') + ' = ?' : '') + ' WHERE job_id = ?',
                [inProgress].concat(values).concat([jobID]), (err, row) => {
                    if (err) {
                        return reject(err);
                    }

                    resolve(row);
                });
        });
    }

    updateJobStatus(jobID, status) {
        return new Promise((resolve, reject) => {
            this.database.run('UPDATE job SET status = ? WHERE job_id = ?',
                [
                    status,
                    jobID
                ], (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(row);
                });
        });
    }

    resetAllJobProgress() {
        return new Promise((resolve, reject) => {
            this.database.run('UPDATE job SET in_progress = 0', (err, row) => {
                if (err) {
                    return reject(err);
                }

                resolve(row);
            });
        });
    }

    resetAllJobObjectLock() {
        return new Promise((resolve, reject) => {
            this.database.run('UPDATE job_object SET locked = 0', (err, row) => {
                if (err) {
                    return reject(err);
                }

                resolve(row);
            });
        });
    }

    cleanAll() {
        return new Promise((resolve, reject) => {
            this.database.serialize(() => {
                this.database.run('DELETE FROM job_group', (err) => {
                    err && console.log('[job-repository] failed delete table job_group. [message] ', err);
                });
                this.database.run('DELETE FROM job', (err) => {
                    err && console.log('[job-repository] failed delete table job. [message] ', err);
                });
                this.database.run('DELETE FROM object', (err) => {
                    err && console.log('[job-repository] failed delete table object. [message] ', err);
                });
                this.database.run('DELETE FROM job_type', (err) => {
                    err && console.log('[job-repository] failed delete table job_type. [message] ', err);
                });
                this.database.run('DELETE FROM job_group', (err) => {
                    err && console.log('[job-repository] failed delete table job_group. [message] ', err);
                });
                this.database.run('DELETE FROM job_processor', (err) => {
                    err && console.log('[job-repository] failed delete table job_processor. [message] ', err);
                    resolve();
                });
            });
        });
    }
}
