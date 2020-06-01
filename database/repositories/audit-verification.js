import genesisConfig from '../../core/genesis/genesis-config';
import mutex from '../../core/mutex';
import async from 'async';
import {Database} from '../database';

export default class AuditVerification {
    constructor(database) {
        this.database = database;
    }

    listAuditVerification(where, orderBy, limit, shardID) {
        return new Promise((resolve, reject) => {
            let {sql, parameters} = Database.buildQuery('SELECT * FROM audit_verification', where, orderBy, limit, shardID);
            this.database.all(sql,
                parameters,
                (err, rows) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(rows);
                });
        });
    }

    getAuditVerification(transactionID) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT * from audit_verification WHERE transaction_id = ?', [transactionID],
                (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(row);
                });
        });
    }

    addAuditVerification(auditVerification) {
        return new Promise((resolve, reject) => {
            this.database.run('INSERT INTO audit_verification (transaction_id, shard_id, verification_count, attempt_count, verified_date, is_verified) VALUES (?, ?, ?, ?, ?, ?)',
                [
                    auditVerification.transaction_id,
                    auditVerification.shard_id,
                    auditVerification.verification_count,
                    auditVerification.attempt_count,
                    auditVerification.verified_date,
                    auditVerification.is_verified
                ],
                (err) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve();
                });
        });
    }

    addAuditVerificationEntries(entries) {
        if (entries.length === 0) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            let placeholders = entries.map((entry) => '("' + entry[0] + '", "' + entry[4] + '", ' + entry[1] + ', ' + entry[2] + (entry[3] ? ', ' + Math.floor(entry[3].getTime() / 1000) + ', 1)' : ', NULL, 0)')).join(',');
            mutex.lock(['transaction' + (this.database.shardID ? '_' + this.database.shardID : '')], (unlock) => {
                this.database.run('BEGIN TRANSACTION', (err) => {
                    if (err) {
                        reject(err);
                        return unlock();
                    }

                    return new Promise((_resolve, _reject) => {
                        this.database.run('INSERT INTO audit_verification (transaction_id, shard_id, verification_count, attempt_count, verified_date, is_verified) VALUES ' + placeholders,
                            (_err) => {
                                if (_err) {
                                    return _reject(_err);
                                }
                                _resolve();
                            });
                    })
                        .then(() => {
                            this.database.run('COMMIT', (_err) => {
                                if (_err) {
                                    return Promise.reject(_err);
                                }

                                resolve();
                                unlock();
                            });
                        })
                        .catch((err) => {
                            console.log(err);
                            this.database.run('ROLLBACK', (_err) => {
                                if (_err) {
                                    reject(_err);
                                    return unlock();
                                }

                                reject(err);
                                unlock();
                            });
                        });
                });
            }, true);
        });
    }

    updateAuditVerification(entries) {
        if (entries.length === 0) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            mutex.lock(['transaction' + (this.database.shardID ? '_' + this.database.shardID : '')], (unlock) => {
                this.database.run('BEGIN TRANSACTION', (err) => {
                    if (err) {
                        reject(err);
                        return unlock();
                    }

                    async.eachSeries(entries, (entry, callback) => {
                        if (entry[2]) {
                            entry[2] = Math.floor(entry[2].getTime() / 1000);
                        }

                        this.database.run('UPDATE audit_verification SET verification_count=?, attempt_count=?, verified_date=?, is_verified = ? WHERE transaction_id=?', entry,
                            (_err) => {
                                if (_err) {
                                    console.error('[audit point] update failed for ', entry[3], '. [message]: ', _err);
                                }
                                callback();
                            });
                    }, () => {
                        this.database.run('COMMIT', (err) => {
                            if (err) {
                                this.database.run('ROLLBACK', (_err) => {
                                    if (_err) {
                                        reject(_err);
                                        return unlock();
                                    }

                                    reject(err);
                                    unlock();
                                });
                                return;
                            }

                            resolve();
                            unlock();
                        });
                    });

                });
            }, true);
        });
    }
}
