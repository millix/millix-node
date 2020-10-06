import console from '../../core/console';
import mutex from '../../core/mutex';
import config from '../../core/config/config';
import _ from 'lodash';
import genesisConfig from '../../core/genesis/genesis-config';
import moment from 'moment';

export default class AuditPoint {
    constructor(database) {
        this.database = database;
    }

    getValidAuditPoints(transactions) {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT DISTINCT transaction_id FROM transaction_output WHERE transaction_id IN ( ' + transactions.map(() => '?').join(',') + ' ) AND is_double_spend = 0 AND is_stable = 1',
                transactions, (err, rowsQueryOutput) => {
                    if (err) {
                        return reject(err);
                    }
                    this.database.all('SELECT DISTINCT transaction_id FROM audit_point WHERE transaction_id IN ( ' + transactions.map(() => '?').join(',') + ' )',
                        transactions, (err, rowsQueryAuditPoint) => {
                            if (err) {
                                return reject(err);
                            }
                            let rows = Array.from(new Set(rowsQueryOutput.concat(rowsQueryAuditPoint)));
                            resolve(rows);
                        });
                });
        });
    }

    getAuditPointCandidateTransactions() {
        return new Promise((resolve, reject) => {
            mutex.lock(['get-audit-point-candidate' + (this.database.shardID ? '_' + this.database.shardID : '')], unlock => {
                this.database.all('SELECT DISTINCT audit_verification.transaction_id, audit_verification.shard_id FROM audit_verification LEFT JOIN audit_point ON audit_verification.transaction_id = audit_point.transaction_id  WHERE verified_date IS NULL AND attempt_count < ? AND audit_point_id IS NULL LIMIT '
                                  + config.AUDIT_POINT_CANDIDATE_MAX, [config.AUDIT_POINT_ATTEMPT_MAX], (err, pendingCandidates) => {
                    if (err) {
                        reject(err);
                        return unlock();
                    }

                    if (pendingCandidates.length === config.AUDIT_POINT_CANDIDATE_MAX) {
                        resolve(pendingCandidates);
                        return unlock();
                    }

                    this.database.all('SELECT DISTINCT transaction_output.transaction_id, transaction_output.shard_id \
                                        FROM transaction_output \
                                        INNER JOIN `transaction` ON `transaction`.transaction_id = transaction_output.transaction_id \
                                        WHERE transaction_output.is_double_spend = 0 \
                                        AND transaction_output.is_stable = 1 \
                                        AND +`transaction`.status = 1 \
                                        AND transaction_output.transaction_id NOT IN (SELECT transaction_id from audit_point) \
                                        AND transaction_output.transaction_id NOT IN (SELECT transaction_id from audit_verification) \
                                        LIMIT ' + (config.AUDIT_POINT_CANDIDATE_MAX - pendingCandidates.length), (err, rows) => {
                        if (err) {
                            reject(err);
                            return unlock();
                        }
                        resolve(Array.from(new Set(pendingCandidates.concat(rows))));
                        unlock();
                    });

                });
            });
        });
    }

    isAuditPoint(transactionID) {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT transaction_id FROM audit_point WHERE transaction_id = ?',
                [transactionID], (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve(!!(rows && rows.length > 0));
                });
        });
    }

    getAuditPoint(transactionID) {

        if (!transactionID) {
            return Promise.resolve(null);
        }

        return new Promise((resolve, reject) => {
            this.database.get('SELECT * FROM audit_point WHERE transaction_id = ? LIMIT 1', [transactionID],
                (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(row);
                });
        });
    }

    addTransactionToAuditPoint(auditPoint) {
        return new Promise((resolve, reject) => {
            this.database.run('INSERT INTO audit_point (audit_point_id, transaction_id, shard_id) VALUES (?,?,?)', [
                    auditPoint.audit_point_id,
                    auditPoint.transaction_id,
                    auditPoint.shard_id
                ],
                (err) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve();
                });
        });
    }

    addTransactionToAuditPointEntries(entries) {
        if (entries.length === 0) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            let placeholders = entries.map((entry) => `("${entry[0]}", "${entry[1]}", "${genesisConfig.genesis_shard_id}")`).join(',');
            mutex.lock(['transaction' + (this.database.shardID ? '_' + this.database.shardID : '')], (unlock) => {
                this.database.run('BEGIN TRANSACTION', (err) => {
                    if (err) {
                        reject(err);
                        return unlock();
                    }

                    return new Promise((_resolve, _reject) => {
                        this.database.run('INSERT INTO audit_point (audit_point_id, transaction_id, shard_id) VALUES ' + placeholders, (_err) => {
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

    updateTransactionToPrune(addressKeyIdentifier) {
        return new Promise((resolve, reject) => {
            let date = moment().subtract(config.TRANSACTION_PRUNE_AGE_MIN, 'minute').toDate();
            if (config.WALLET_SPENT_TRANSACTION_PRUNE) {

                this.database.all('SELECT audit_point.transaction_id FROM audit_point \
                INNER JOIN `transaction` on `transaction`.transaction_id = audit_point.transaction_id \
                INNER JOIN transaction_output ON transaction_output.transaction_id = `transaction`.transaction_id \
                LEFT JOIN keychain_address ON transaction_output.address = keychain_address.address \
                WHERE keychain_address.address_key_identifier=? AND transaction_output.is_spent = 1 \
                AND +`transaction`.status = 2  AND `transaction`.transaction_date < ? LIMIT 100', [
                    addressKeyIdentifier,
                    Math.floor(date.getTime() / 1000)
                ], (err, transactions) => {
                    if (err) {
                        console.log(err);
                        return reject();
                    }

                    transactions = transactions.map(transaction => transaction.transaction_id);

                    this.database.run('UPDATE `transaction` SET status = 0 WHERE transaction_id IN (' + transactions.map(() => '?').join(',') + ')', transactions, (err) => {
                        if (err) {
                            console.log(err);
                            return reject();
                        }

                        this.database.all('SELECT audit_point.transaction_id FROM audit_point  \
                                    INNER JOIN `transaction` on `transaction`.transaction_id = audit_point.transaction_id  \
                                    WHERE audit_point.status = 1 AND +`transaction`.status = 2  AND +`transaction`.transaction_date < ? \
                                    AND audit_point.transaction_id NOT IN (SELECT transaction_id FROM transaction_output \
                                    WHERE address_key_identifier=?) \
                                    LIMIT 100', [
                            Math.floor(date.getTime() / 1000),
                            addressKeyIdentifier
                        ], (err, rows) => {
                            if (err) {
                                console.log(err);
                                return reject();
                            }

                            rows = rows.map(row => row.transaction_id);

                            this.database.run('UPDATE `transaction` SET status = 0 WHERE transaction_id IN (' + rows.map(() => '?').join(',') + ')', rows, (err) => {
                                if (err) {
                                    console.log(err);
                                    return reject();
                                }
                                transactions = transactions.concat(rows);
                                this.database.run('UPDATE audit_point SET status = 0 WHERE transaction_id IN (' + transactions.map(() => '?').join(',') + ')', transactions, (err) => {
                                    if (err) {
                                        console.log(err);
                                        return reject();
                                    }
                                    console.log('[Database] Transactions before', date, ' set to be pruned. Row(s) updated: ', transactions.length);
                                    resolve();
                                });
                            });

                        });

                    });

                });
            }
            else {
                this.database.all('SELECT audit_point.transaction_id FROM audit_point  \
                INNER JOIN `transaction` on `transaction`.transaction_id = audit_point.transaction_id  \
                WHERE audit_point.status = 1 AND +`transaction`.status = 2  AND +`transaction`.transaction_date < ? \
                AND audit_point.transaction_id NOT IN (SELECT transaction_id FROM transaction_output \
                WHERE address_key_identifier=?) \
                LIMIT 100', [
                    Math.floor(date.getTime() / 1000),
                    addressKeyIdentifier
                ], (err, transactions) => {
                    if (err) {
                        console.log(err);
                        return reject();
                    }

                    transactions = transactions.map(transaction => transaction.transaction_id);

                    this.database.run('UPDATE `transaction` SET status = 0 WHERE transaction_id IN (' + transactions.map(() => '?').join(',') + ')', transactions, (err) => {
                        if (err) {
                            console.log(err);
                            return reject();
                        }
                        this.database.run('UPDATE audit_point SET status = 0 WHERE transaction_id IN (' + transactions.map(() => '?').join(',') + ')', transactions, function(err) {
                            if (err) {
                                console.log(err);
                                return reject();
                            }
                            console.log('[Database] Transactions before', date, ' set to be pruned. Row(s) updated: ', this.changes);
                            resolve();
                        });
                    });

                });
            }
        });
    }

    pruneTransaction() {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT transaction_id FROM `transaction` where status = 0 LIMIT ' + Math.min(config.TRANSACTION_PRUNE_COUNT, 250), (err, rows) => {
                if (err) {
                    console.log(err);
                    return reject();
                }
                let transactions = rows.map(transaction => transaction.transaction_id);
                console.log('[Database] ', transactions.length, ' transactions will be pruned');

                if (transactions.length === 0) {
                    return resolve();
                }

                this.database.serialize(() => {
                    this.database.run('DELETE FROM transaction_input WHERE transaction_id IN  ( ' + transactions.map(() => '?').join(',') + ' )', transactions, (err) => {
                        err && console.log('[Database] Failed pruning inputs. [message] ', err);
                    });
                    this.database.run('DELETE FROM transaction_output WHERE transaction_id IN  ( ' + transactions.map(() => '?').join(',') + ' )', transactions, (err) => {
                        err && console.log('[Database] Failed pruning outputs. [message] ', err);
                    });
                    this.database.run('DELETE FROM transaction_signature WHERE transaction_id IN  ( ' + transactions.map(() => '?').join(',') + ' )', transactions, (err) => {
                        err && console.log('[Database] Failed pruning signatures. [message] ', err);
                    });
                    this.database.run('DELETE FROM transaction_parent WHERE transaction_id_child IN  ( ' + transactions.map(() => '?').join(',') + ' )', transactions, (err) => {
                        err && console.log('[Database] Failed pruning parents. [message] ', err);
                    });
                    this.database.run('DELETE FROM audit_verification WHERE transaction_id IN  ( ' + transactions.map(() => '?').join(',') + ' )', transactions, (err) => {
                        err && console.log('[Database] Failed pruning audit verifications. [message] ', err);
                    });
                    this.database.run('DELETE FROM `transaction` WHERE transaction_id IN  ( ' + transactions.map(() => '?').join(',') + ' )', transactions, (err) => {
                        err && console.log('[Database] Failed pruning transactions. [message] ', err);
                        resolve();
                    });
                });
            });
        });
    }

    deleteAuditPoint(transactionID) {
        return new Promise((resolve) => {
            this.database.serialize(() => {
                this.database.run('DELETE FROM audit_verification WHERE transaction_id = ?', transactionID, (err) => {
                    err && console.log('[Database] Failed delete audit verifications. [message] ', err);
                });
                this.database.run('DELETE FROM audit_point WHERE transaction_id = ?', transactionID, (err) => {
                    err && console.log('[Database] Failed delete audit point. [message] ', err);
                    resolve();
                });
            });
        });
    }

    pruneAuditPoint() {
        return new Promise((resolve, reject) => {
            let date = moment().subtract(config.AUDIT_POINT_PRUNE_AGE_MIN, 'minute').toDate();
            this.database.run('DELETE FROM audit_point WHERE audit_point_id IN (SELECT audit_point_id FROM audit_point WHERE create_date < ? LIMIT ' + Math.min(config.AUDIT_POINT_PRUNE_COUNT, 250) + ')',
                [Math.floor(date.getTime() / 1000)], function(err) {
                    if (err) {
                        console.log(err);
                        return reject();
                    }
                    console.log('[Database] ', this.changes, ' audit points (created before ', date, ') pruned');
                    return resolve();
                });
        });
    }
}
