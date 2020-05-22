import mutex from '../../core/mutex';
import _ from 'lodash';
import ntp from '../../core/ntp';
import eventBus from '../../core/event-bus';
import config from '../../core/config/config';
import genesisConfig from '../../core/genesis/genesis-config';
import async from 'async';
import database, {Database} from '../database';

export default class Transaction {
    constructor(database) {
        this.database = database;
    }

    setAddressRepository(repository) {
        this.addressRepository = repository;
    }

    getAddressBalance(address, stable) {
        return new Promise((resolve) => {
            this.database.get('SELECT SUM(amount) as amount FROM transaction_output INNER JOIN `transaction` ON `transaction`.transaction_id = transaction_output.transaction_id ' +
                              'WHERE address=? and `transaction`.is_stable = ' + (stable ? 1 : 0) + ' AND is_spent = 0', [address],
                (err, row) => {
                    resolve(row ? row.amount || 0 : 0);
                });
        });
    }

    getAddressesUnstableTransactions(addresses, minIncludePathLength, excludeTransactionIDList) {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT `transaction`.* FROM `transaction` ' +
                              'INNER JOIN transaction_output ON transaction_output.transaction_id = `transaction`.transaction_id ' +
                              'WHERE transaction_output.address IN ( ' + addresses.map(() => '?').join(',') + ' ) ' + (excludeTransactionIDList ? 'AND `transaction`.transaction_id NOT IN (' + excludeTransactionIDList.map(() => '?').join(',') + ')' : '') + 'AND +`transaction`.is_stable = 0 ORDER BY transaction_date DESC LIMIT 100', addresses.concat(excludeTransactionIDList),
                (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }

                    if (minIncludePathLength === undefined) {
                        return resolve(rows);
                    }
                    else {
                        let filteredRows = [];
                        async.eachSeries(rows, (row, callback) => {

                            this.getTransactionIncludePaths(row.transaction_id)
                                .then(paths => {
                                    if (_.some(paths, path => path.length >= minIncludePathLength)) {
                                        filteredRows.push(row);
                                    }
                                    callback();
                                });

                        }, () => {
                            resolve(filteredRows);
                        });
                    }

                });
        });
    }

    getTransactionByOutputAddress(address, fromTimestamp) {
        return new Promise((resolve, reject) => {
            let dateTime = Math.floor(fromTimestamp.getTime() / 1000);
            this.database.all(
                'SELECT DISTINCT `transaction`.* FROM `transaction` \
                INNER JOIN transaction_output on `transaction`.transaction_id = transaction_output.transaction_id \
                WHERE address=?' + (fromTimestamp ? ' AND `transaction`.transaction_date > ?' : '') + ' ORDER BY transaction_output.create_date LIMIT 100',
                [
                    address,
                    dateTime
                ],
                (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve(rows);
                }
            );
        });
    }

    getTransactionsByAddressKeyIdentifier(keyIdentifier) {
        return new Promise((resolve, reject) => {
            this.database.all(
                'SELECT `transaction`.*, transaction_input.address as input_address, transaction_output.address as output_address, transaction_output.amount as amount FROM `transaction` \
                LEFT JOIN  transaction_output on transaction_output.transaction_id = `transaction`.transaction_id \
                LEFT JOIN  transaction_input on transaction_input.transaction_id = `transaction`.transaction_id \
                WHERE transaction_output.address_key_identifier = ? \
                UNION SELECT `transaction`.*, transaction_input.address as input_address, transaction_output.address as output_address, transaction_output.amount as amount FROM `transaction` \
                LEFT JOIN  transaction_input on transaction_input.transaction_id = `transaction`.transaction_id  \
                LEFT JOIN  transaction_output on transaction_output.transaction_id = `transaction`.transaction_id \
                WHERE transaction_input.address_key_identifier = ? \
                ORDER BY `transaction`.transaction_date DESC',
                [
                    keyIdentifier,
                    keyIdentifier
                ],
                (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve(rows);
                }
            );
        });
    }

    addTransactionFromObject(transaction) {
        return new Promise((resolve, reject) => {
            mutex.lock(['transaction'], (unlock) => {
                this.database.run('BEGIN TRANSACTION', (err) => {
                    if (err) {
                        reject(err);
                        return unlock();
                    }

                    let runPipeline = null;
                    let promise     = new Promise(r => {
                        runPipeline = r;
                    });
                    let addressList = {};

                    transaction.transaction_parent_list.forEach(parentTransaction => {
                        promise = promise.then(() => {
                            return new Promise((resolve, reject) => {
                                database.firstShards((shardID) => {
                                    return new Promise((resolve, reject) => {
                                        const transactionRepository = database.getRepository('transaction', shardID);
                                        transactionRepository.getTransaction(parentTransaction)
                                                             .then(foundParentTransaction => foundParentTransaction ? resolve(transactionRepository) : reject());
                                    });
                                }).then(parentRepository => {
                                    if (parentRepository) {
                                        parentRepository.updateTransactionParentDate(parentTransaction, new Date(transaction.transaction_date))
                                                        .then(() => resolve())
                                                        .catch(() => reject());
                                    }
                                    else {
                                        resolve();
                                    }
                                });
                            });
                        });
                    });

                    transaction.transaction_input_list.forEach(input => {
                        input.address              = input.address_base + input.address_version + input.address_key_identifier;
                        addressList[input.address] = _.pick(input, [
                            'address',
                            'address_base',
                            'address_version',
                            'address_key_identifier'
                        ]);
                        promise                    = promise.then(() => {
                            const transactionOutputRepository = database.getRepository('transaction', input.output_shard_id);
                            if (!transactionOutputRepository) {
                                return Promise.resolve();
                            }
                            return transactionOutputRepository.updateTransactionOutput(input.output_transaction_id, input.output_position, ntp.now());
                        });
                    });

                    promise = promise.then(() => {
                        return new Promise(resolve => {
                            database.applyShards((shardID) => {
                                const transactionRepository = database.getRepository('transaction', shardID);
                                return transactionRepository.getTransactionParentDate(transaction.transaction_id);
                            }).then(dates => resolve(_.min(dates)));
                        });
                    }).then(parentDate => this.addTransaction(transaction.transaction_id, transaction.shard_id, transaction.payload_hash, new Date(transaction.transaction_date), transaction.node_id_origin, transaction.version, parentDate));

                    transaction.transaction_parent_list.forEach(parentTransaction => {
                        promise = promise.then(() => this.addTransactionParent(transaction.transaction_id, parentTransaction, transaction.shard_id));
                    });

                    transaction.transaction_input_list.forEach(input => {
                        promise = promise.then(() => {
                            this.addTransactionInput(transaction.transaction_id, transaction.shard_id, input.input_position, input.address, input.address_key_identifier, input.output_transaction_id, input.output_position, input.output_transaction_date, input.output_shard_id);
                            delete input['address'];
                        });
                    });

                    transaction.transaction_output_list.forEach(output => {
                        output.address              = output.address_base + output.address_version + output.address_key_identifier;
                        addressList[output.address] = _.pick(output, [
                            'address',
                            'address_base',
                            'address_version',
                            'address_key_identifier'
                        ]);
                        promise                     = promise.then(() => {
                            return new Promise(resolve => {
                                database.applyShards((shardID) => {
                                    const transactionRepository = database.getRepository('transaction', shardID);
                                    return transactionRepository.getOutputSpendDate(transaction.transaction_id, output.output_position);
                                }).then(dates => resolve(_.min(dates)));
                            });
                        }).then(spendDate => {
                            this.addTransactionOutput(transaction.transaction_id, transaction.shard_id, output.output_position, output.address, output.address_key_identifier, output.amount, spendDate);
                            delete output['address'];
                        });
                    });

                    transaction.transaction_signature_list.forEach(author => {
                        _.each(_.keys(addressList), addressKey => {
                            if (addressKey.startsWith(author.address_base)) {
                                let address = addressList[addressKey];
                                delete addressList[addressKey];
                                promise = promise.then(() => this.addressRepository.addAddress(address.address, address.address_base, address.address_version, address.address_key_identifier, author.address_attribute));
                            }
                        });
                        promise = promise.then(() => this.addTransactionSignature(transaction.transaction_id, transaction.shard_id, author));
                    });

                    _.each(_.keys(addressList), key => {
                        let address = addressList[key];
                        promise     = promise.then(() => this.addressRepository.addAddress(address.address, address.address_base, address.address_version, address.address_key_identifier));
                    });

                    promise.then(() => this.database.run('COMMIT', () => {
                        eventBus.emit('transaction_new:' + transaction.transaction_id, transaction);
                        resolve(transaction);
                        unlock();
                    }))
                           .catch((err) => {
                               this.database.run('ROLLBACK', () => {
                                   reject(err);
                                   unlock();
                               });
                           });
                    runPipeline();
                });
            });
        });
    }


    normalizeTransactionObject(transactionDB) {
        if (!transactionDB) {
            return null;
        }
        //TODO: check genesis case
        let transaction                        = {};
        transaction['transaction_id']          = transactionDB.transaction_id;
        transaction['payload_hash']            = transactionDB.payload_hash;
        transaction['transaction_parent_list'] = transactionDB.transaction_parent_list.sort();
        transactionDB.transaction_output_list.forEach(output => {
            const outputAddress       = this.addressRepository.getAddressComponent(output.address);
            output['address_base']    = outputAddress['address'];
            output['address_version'] = outputAddress['version'];
        });
        transaction['transaction_output_list'] = _.sortBy(transactionDB.transaction_output_list.map(o => _.pick(o, [
            'output_position',
            'address_base',
            'address_version',
            'address_key_identifier',
            'amount'
        ])), 'output_position');
        transactionDB.transaction_input_list.forEach(input => {
            const inputAddress       = this.addressRepository.getAddressComponent(input.address);
            input['address_base']    = inputAddress['address'];
            input['address_version'] = inputAddress['version'];
        });
        transaction['transaction_input_list']     = _.sortBy(transactionDB.transaction_input_list.map(i => _.pick(i, [
            'input_position',
            'output_transaction_id',
            'output_transaction_date',
            'output_shard_id',
            'output_position',
            'address_base',
            'address_version',
            'address_key_identifier'
        ])), 'input_position');
        transaction['transaction_signature_list'] = transactionDB.transaction_signature_list.map(a => _.pick(a, [
            'address_base',
            'address_attribute',
            'signature'
        ]));
        transaction['transaction_date']           = transactionDB.transaction_date.toISOString();
        transaction['version']                    = transactionDB.version;
        transaction['node_id_origin']             = transactionDB.node_id_origin;
        transaction['shard_id']                   = transactionDB.shard_id;
        return transaction;
    }

    getTransactionObject(transactionID) {
        return new Promise(resolve => {
            this.getTransaction(transactionID)
                .then(transaction => {

                    if (!transaction) {
                        return Promise.reject();
                    }

                    return this.getTransactionOutputs(transactionID)
                               .then(outputs => {
                                   transaction.transaction_output_list = outputs;
                                   return transaction;
                               });
                })
                .then(transaction => {
                    return this.getTransactionInputs(transactionID)
                               .then(inputs => {
                                   transaction.transaction_input_list = inputs;
                                   return transaction;
                               });
                })
                .then(transaction => {
                    return this.getTransactionSignatures(transactionID)
                               .then(signatures => {
                                   transaction.transaction_signature_list = signatures;
                                   return transaction;
                               });
                })
                .then(transaction => {
                    return this.getTransactionParents(transactionID)
                               .then(parents => {
                                   transaction.transaction_parent_list = parents;

                                   //TODO: check this... some data is missing
                                   if (transaction.transaction_id !== genesisConfig.genesis_transaction &&
                                       (!transaction.transaction_output_list || transaction.transaction_output_list.length === 0 ||
                                        !transaction.transaction_input_list || transaction.transaction_input_list.length === 0 ||
                                        !transaction.transaction_signature_list || transaction.transaction_signature_list.length === 0)) {
                                       return null;
                                   }

                                   return transaction;
                               });
                })
                .then(transaction => resolve(transaction))
                .catch(() => resolve(null));
        });
    }


    addTransactionSignature(transactionID, shardID, author) {
        return new Promise((resolve) => {
            this.database.run('INSERT INTO transaction_signature (transaction_id, shard_id, address_base, signature) VALUES (?,?,?,?)', [
                transactionID,
                shardID,
                author.address_base,
                author.signature
            ], _ => {
                resolve();
            });
        });
    }

    addTransactionParent(transactionIDChild, transactionIDParent, shardID) {
        return new Promise((resolve, reject) => {
            this.database.run('INSERT INTO transaction_parent (transaction_id_child, transaction_id_parent, shard_id) VALUES (?,?,?)', [
                transactionIDChild,
                transactionIDParent,
                shardID
            ], (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }

    updateTransactionParentDate(transactionID, parentDate) {
        return new Promise((resolve, reject) => {
            this.database.run('UPDATE `transaction` SET parent_date = ?, is_parent = ? WHERE transaction_id = ?', [
                Math.floor(parentDate.getTime() / 1000),
                !!parentDate ? 1 : 0,
                transactionID
            ], (err) => {
                if (err) {
                    return reject(err);
                }
                console.log('Update transaction  ' + transactionID);
                resolve();
            });
        });
    }

    updateTransactionOutput(transactionID, outputPosition, spentDate, stableDate, doubleSpendDate) {
        return new Promise((resolve, reject) => {
            let sql = 'UPDATE transaction_output SET';

            if (spentDate === null) {
                sql += ' spent_date = NULL, is_spent = 0,';
            }
            else if (spentDate) {
                sql += ' spent_date = ' + Math.floor(spentDate.getTime() / 1000) + ', is_spent = 1,';
            }

            if (doubleSpendDate === null) {
                sql += ' double_spend_date = NULL, is_double_spend = 0,';
            }
            else if (doubleSpendDate) {
                sql += ' double_spend_date = ' + Math.floor(doubleSpendDate.getTime() / 1000) + ', is_double_spend = 1,';
            }

            if (stableDate === null) {
                sql += ' stable_date = NULL, is_stable = 0,';
            }
            else if (stableDate) {
                sql += ' stable_date = ' + Math.floor(stableDate.getTime() / 1000) + ', is_stable = 1,';
            }

            sql = sql.substring(0, sql.length - 1);

            this.database.run(sql + ' WHERE transaction_id = ? and output_position = ?', [
                transactionID,
                outputPosition
            ], (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }

    updateTransactionInput(transactionID, inputPosition, doubleSpendDate) {
        return new Promise((resolve, reject) => {
            let sql = 'UPDATE transaction_input SET';

            if (doubleSpendDate === null) {
                sql += ' double_spend_date = NULL, is_double_spend = 0,';
            }
            else if (doubleSpendDate) {
                sql += ' double_spend_date = ' + Math.floor(doubleSpendDate.getTime() / 1000) + ', is_double_spend = 1';
            }

            this.database.run(sql + ' WHERE transaction_id = ? and input_position = ?', [
                transactionID,
                inputPosition
            ], (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }


    updateAllTransactionOutput(transactionID, spentDate, stableDate, doubleSpendDate) {
        return new Promise((resolve, reject) => {
            let sql = 'UPDATE transaction_output SET ';

            if (spentDate === null) {
                sql += ' spent_date = NULL, is_spent = 0,';
            }
            else if (spentDate) {
                sql += ' spent_date = ' + Math.floor(spentDate.getTime() / 1000) + ', is_spent = 1,';
            }

            if (doubleSpendDate === null) {
                sql += ' double_spend_date = NULL, is_double_spend = 0,';
            }
            else if (doubleSpendDate) {
                sql += ' double_spend_date = ' + Math.floor(doubleSpendDate.getTime() / 1000) + ', is_double_spend = 1,';
            }

            if (stableDate === null) {
                sql += ' stable_date = NULL, is_stable = 0,';
            }
            else if (stableDate) {
                sql += ' stable_date = ' + Math.floor(stableDate.getTime() / 1000) + ', is_stable = 1,';
            }

            sql = sql.substring(0, sql.length - 1);

            this.database.run(sql + ' WHERE transaction_id = ?', [transactionID], (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }


    getTransactionParents(transactionID) {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT transaction_id_parent FROM transaction_parent WHERE transaction_id_child = ?',
                [transactionID], (err, rows) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(rows.map(r => r.transaction_id_parent));
                });
        });
    }

    getTransactionChildren(transactionID) {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT transaction_id_child FROM transaction_parent WHERE transaction_id_parent = ?',
                [transactionID], (err, rows) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(rows.map(r => r.transaction_id_child));
                });
        });
    }

    getTransactionOutputs(transactionID) {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT * FROM transaction_output WHERE transaction_id = ?',
                [transactionID], (err, rows) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(rows);
                });
        });
    }

    getTransactionInputs(transactionID) {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT * FROM transaction_input WHERE transaction_id = ?',
                [transactionID], (err, rows) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(rows);
                });
        });
    }

    listTransactionInput(where, orderBy, limit, shardID) {
        return new Promise((resolve, reject) => {
            let {sql, parameters} = Database.buildQuery('SELECT transaction_input.*, `transaction`.transaction_date FROM `transaction_input` INNER JOIN `transaction` ON transaction_input.transaction_id = `transaction`.transaction_id', where, orderBy, limit, shardID);
            this.database.all(sql,
                parameters, (err, rows) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(rows);
                });
        });
    }

    listTransactionOutput(where, orderBy, limit, shardID) {
        return new Promise((resolve, reject) => {
            let {sql, parameters} = Database.buildQuery('SELECT transaction_output.*, `transaction`.transaction_date FROM `transaction_output` INNER JOIN `transaction` ON transaction_output.transaction_id = `transaction`.transaction_id', where, orderBy, limit, shardID);
            this.database.all(sql,
                parameters, (err, rows) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(rows);
                });
        });
    }

    getTransactionInput(where) {
        return new Promise((resolve, reject) => {
            let {sql, parameters} = Database.buildQuery('SELECT * FROM `transaction_input`', where);
            this.database.get(sql,
                parameters, (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(row);
                });
        });
    }

    getTransactionOutput(where) {
        return new Promise((resolve, reject) => {
            let {sql, parameters} = Database.buildQuery('SELECT * FROM `transaction_output`', where);
            this.database.get(sql,
                parameters, (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(row);
                });
        });
    }

    isTransactionStable(transactionID) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT transaction_id FROM `transaction` WHERE transaction_id = ? AND is_stable = 0',
                [transactionID], (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(!!row);
                });
        });
    }

    getTransactionUnstableInputs(transactionID) {
        return this.getTransactionInputs(transactionID)
                   .then(inputs => {
                       const unstableInputs = [];
                       return new Promise(resolve => {
                           async.eachSeries(inputs, (input, callback) => {
                               const transactionRepository = database.getRepository('transaction', input.output_shard_id);
                               if (transactionRepository) {
                                   transactionRepository.isTransactionStable(input.output_transaction_id)
                                                        .then((isStable) => {
                                                            if (!isStable) {
                                                                unstableInputs.push(input);
                                                            }
                                                            callback();
                                                        })
                                                        .catch(() => callback());
                               }
                               else {
                                   callback();
                               }
                           }, () => {
                               resolve(unstableInputs);
                           });
                       });
                   });
    }

    getTransactionSignatures(transactionID) {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT * FROM transaction_signature WHERE transaction_id = ?',
                [transactionID], (err, rows) => {
                    if (err) {
                        return reject(err);
                    }

                    let authors = [];
                    async.eachSeries(rows, (signature, callback) => {
                        this.addressRepository
                            .getAddressBaseAttribute(signature.address_base)
                            .then(addressAttribute => {
                                authors.push({...addressAttribute, ...signature});
                                callback();
                            });
                    }, () => resolve(authors));
                });
        });
    }

    addTransaction(transactionID, shardID, payloadHash, transactionDate, ipAddressOrigin, version, parentDate) {
        return new Promise((resolve, reject) => {
            this.database.run('INSERT INTO `transaction` (transaction_id, version, shard_id, payload_hash, transaction_date, node_id_origin, parent_date, is_parent) VALUES (?,?,?,?,?,?,?,?)', [
                transactionID,
                version,
                shardID,
                payloadHash,
                Math.floor(transactionDate.getTime() / 1000),
                ipAddressOrigin,
                parentDate ? Math.floor(parentDate.getTime() / 1000) : undefined,
                !!parentDate ? 1 : 0
            ], (err) => {
                if (err) {
                    return reject(err);
                }
                console.log('New transaction added ' + transactionID);
                resolve();
            });
        });
    }

    addTransactionInput(transactionID, shardID, inputPosition, address, addressKeyIdentifier, outputTransactionID, outputPosition, outputTransactionDate, outputShardID) {
        return new Promise((resolve, reject) => {
            this.database.run('INSERT INTO transaction_input (transaction_id, shard_id, input_position, address, address_key_identifier, output_transaction_id, output_position, output_transaction_date, output_shard_id) VALUES (?,?,?,?,?,?,?,?,?)', [
                transactionID,
                shardID,
                inputPosition,
                address,
                addressKeyIdentifier,
                outputTransactionID,
                outputPosition,
                outputTransactionDate,
                outputShardID
            ], (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }

    addTransactionOutput(transactionID, shardID, outputPosition, address, addressKeyIdentifier, amount, spentDate) {
        return new Promise((resolve, reject) => {
            this.database.run('INSERT INTO transaction_output (transaction_id, shard_id, output_position, address, address_key_identifier, amount, spent_date, is_spent) VALUES (?,?,?,?,?,?,?,?)', [
                transactionID,
                shardID,
                outputPosition,
                address,
                addressKeyIdentifier,
                amount,
                spentDate ? Math.floor(spentDate.getTime() / 1000) : null,
                !!spentDate ? 1 : 0
            ], (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }

    findUnstableTransaction(minIncludePathLength, excludeTransactionIDList) {
        return new Promise((resolve, reject) => {
            let search = (timestampAfter) => {
                this.database.all('SELECT * FROM `transaction` WHERE +`transaction`.is_stable = 0 AND `transaction`.transaction_date < ? ' + (excludeTransactionIDList ? 'AND `transaction`.transaction_id NOT IN (' + excludeTransactionIDList.map(() => '?').join(',') + ')' : '') + 'ORDER BY transaction_date DESC LIMIT 100',
                    [timestampAfter].concat(excludeTransactionIDList), (err, rows) => {
                        if (err) {
                            console.log(err);
                            return reject(err);
                        }
                        else if (rows.length === 0) {
                            resolve([]);
                        }
                        else if (minIncludePathLength === undefined) {
                            return resolve(rows[0]);
                        }
                        else {
                            async.eachSeries(rows, (row, callback) => {
                                this.getTransactionIncludePaths(row.transaction_id)
                                    .then(paths => {
                                        if (_.some(paths, path => path.length >= minIncludePathLength)) {
                                            return callback(row);
                                        }
                                        callback();
                                    });

                            }, (row) => {
                                if (!row) {
                                    search(rows[rows.length - 1].transaction_date);
                                }
                                else {
                                    resolve([row]);
                                }
                            });
                        }

                    });
            };

            search(Math.floor(ntp.now().getTime() / 1000));
        });
    }

    getTransactionIncludePaths(transactionID, maxDepth) {
        maxDepth = maxDepth || config.CONSENSUS_ROUND_PATH_LENGTH_MIN;
        return new Promise((resolve) => {
            let visited = {};
            const dfs   = (branches, depth) => {
                let hasTransactions = false;
                let newBranches     = [];

                async.eachSeries(branches, (branch, branchCallback) => {
                    if (branch.transactions.length === 0) {
                        newBranches.push(branch);
                        return branchCallback();
                    }

                    async.eachSeries(branch.transactions, (transaction, callback) => {
                        let newBranch          = _.cloneDeep(branch);
                        newBranch.transactions = [];
                        if (visited[transaction]) {
                            newBranches.push(newBranch);
                            return callback();
                        }

                        visited[transaction] = true;
                        newBranch.path.push(transaction);
                        newBranches.push(newBranch);

                        database.applyShards((shardID) => {
                            const transactionRepository = database.getRepository('transaction', shardID);
                            return transactionRepository.getTransactionChildren(transaction);
                        }).then(children => {
                            if (children.length === 0) {
                                return callback();
                            }
                            newBranch.transactions = children;
                            hasTransactions        = true;
                            callback();
                        });
                    }, () => branchCallback());
                }, () => {
                    if (!hasTransactions || depth >= maxDepth) {
                        // retrieve branches
                        return resolve(_.map(newBranches, branch => branch.path));
                    }
                    else {
                        dfs(newBranches, depth + 1);
                    }
                });
            };

            dfs([
                {
                    transactions: [transactionID],
                    path        : []
                }
            ], 0);
        });
    }

    getTransactionMinDistance(transactionID, targetTransactionID) {
        return new Promise((resolve) => {
            if (targetTransactionID === transactionID) {
                return resolve(0);
            }

            let visited = {};

            const dfs = (branches, depth) => {
                let hasTransactions = false;
                let targetFound     = false;
                let newBranches     = [];

                async.eachSeries(branches, (branch, branchCallback) => {
                    if (branch.transactions.length === 0) {
                        // newBranches.push(branch);
                        return branchCallback();
                    }

                    async.eachSeries(branch.transactions, (transaction, callback) => {
                        let newBranch          = _.cloneDeep(branch);
                        newBranch.transactions = [];
                        if (visited[transaction]) {
                            newBranches.push(newBranch);
                            return callback();
                        }

                        visited[transaction] = true;
                        newBranch.path.push(transaction);
                        newBranches.push(newBranch);
                        database.firstShards((shardID) => {
                            return new Promise((resolve, reject) => {
                                const transactionRepository = database.getRepository('transaction', shardID);
                                transactionRepository.getTransaction(transaction)
                                                     .then(dbTransaction => dbTransaction ? resolve([
                                                         transactionRepository,
                                                         shardID
                                                     ]) : reject());
                            });
                        }).then(data => data || []).then(([transactionRepository, shardID]) => {
                            if (!transactionRepository) {
                                hasTransactions = false;
                                return callback(true);
                            }
                            transactionRepository.getTransactionParents(transaction)
                                                 .then(parents => {
                                                     if (parents.length === 0) {
                                                         return transactionRepository.getTransactionInputs(transaction)
                                                                                     .then(inputs => {
                                                                                         _.each(inputs, input => {
                                                                                             if (input.output_transaction_id === genesisConfig.genesis_transaction) {
                                                                                                 targetFound = true;
                                                                                             }
                                                                                         });
                                                                                     }).then(() => callback(targetFound));
                                                     }
                                                     newBranch.transactions = parents;
                                                     hasTransactions        = true;
                                                     targetFound            = _.includes(newBranch.transactions, targetTransactionID);
                                                     if (!targetFound) {
                                                         database.getRepository('audit_point', shardID).isAuditPoint(transaction)
                                                                 .then(isAuditPoint => {
                                                                     targetFound = isAuditPoint;
                                                                     callback(targetFound);
                                                                 });
                                                     }
                                                     else {
                                                         callback(true);
                                                     }
                                                 });
                        });
                    }, () => branchCallback());
                }, () => {
                    if (targetFound === true) {
                        return resolve(depth + 1);
                    }
                    else if (hasTransactions === false) {
                        return resolve(Infinity);
                    }
                    else {
                        dfs(newBranches, depth + 1);
                    }
                });
            };

            dfs([
                {
                    transactions: [transactionID],
                    path        : []
                }
            ], 0);
        });
    }

    setTransactionAsDoubleSpend(rootTransaction, doubleSpendTransaction) {
        let now = ntp.now();
        return new Promise(resolve => {
            let depth = 0;
            const dfs = (transactions, doubleSpendTransactions) => {
                let allNewTransactions       = [];
                let allNewDoubleTransactions = [];
                async.eachOfSeries(transactions, (transaction, idx, callback) => {
                    const doubleSpendTransaction = doubleSpendTransactions[idx];
                    const transactionRepository  = database.getRepository('transaction', transaction.shard_id);
                    transactionRepository.setTransactionAsStable(transaction.transaction_id)
                                         .then(() => {
                                             return new Promise(resolve => {
                                                 async.eachSeries(transaction.transaction_output_list, (output, callbackOutputs) => {
                                                     transactionRepository.updateTransactionOutput(transaction.transaction_id, output.output_position, now, now, now)
                                                                          .then(() => callbackOutputs());
                                                 }, () => {
                                                     async.eachSeries(transaction.transaction_input_list, (input, callbackInputs) => {
                                                         if (input.output_transaction_id === doubleSpendTransaction) {
                                                             transactionRepository.updateTransactionInput(transaction.transaction_id, input.input_position, now)
                                                                                  .then(() => callbackInputs(true));
                                                         }
                                                         else {
                                                             callbackInputs();
                                                         }
                                                     }, () => resolve());
                                                 });
                                             });
                                         })
                                         .then(() => database.applyShards((shardID) => {
                                             return database.getRepository('transaction', shardID)
                                                            .getTransactionObjectBySpentOutputTransaction(transaction.transaction_id);
                                         }))
                                         .then(newTransactions => {
                                             if (newTransactions && newTransactions.length) {
                                                 allNewTransactions.push(newTransactions);
                                                 allNewDoubleTransactions.push(Array(newTransactions.length).fill(transaction.transaction_id));
                                             }
                                             callback();
                                         });
                }, () => {
                    if (allNewTransactions.length === 0 || depth >= config.CONSENSUS_VALIDATION_REQUEST_DEPTH_MAX) {
                        return resolve();
                    }
                    depth++;
                    dfs(allNewTransactions);
                });

            };
            dfs([rootTransaction], [doubleSpendTransaction]);
        });
    }

    getTransactionObjectBySpentOutputTransaction(transactionID) {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT transaction_id from transaction_input WHERE output_transaction_id = ?',
                [transactionID], (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }

                    if (rows.length === 0) {
                        return resolve([]);
                    }

                    let transactions = [];
                    async.eachSeries(rows, (input, callback) => {
                        this.getTransactionObject(input.transaction_id)
                            .then(transaction => {
                                transactions.push(transaction);
                                callback();
                            });
                    }, () => resolve(transactions));
                });
        });
    }

    isInputDoubleSpend(input, transactionID) {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT * FROM transaction_input WHERE output_transaction_id = ? AND output_position = ? AND transaction_id != ?',
                [
                    input.output_transaction_id,
                    input.output_position,
                    transactionID
                ], (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve([
                        rows ? rows.length !== 0 : false,
                        rows
                    ]);
                });
        });
    }

    getSpendTransactions(transactionID) {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT transaction_id FROM transaction_input WHERE output_transaction_id = ?',
                [transactionID], (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve(rows);
                });
        });
    }

    setPathAsStableFrom(transactionID) {
        return new Promise(resolve => {
            const dfs = (transactions, depth) => {
                let newTransactions = [];
                async.eachSeries(transactions, (transaction, callback) => {
                    mutex.lock(['path-as-stable'], pathAsStableUnlock => {
                        mutex.lock(['transaction'], transactionUnlock => {
                            const transactionRepository = transaction.repository;
                            transactionRepository.setTransactionAsStable(transaction.transaction_id)
                                                 .then(() => transactionRepository.setOutputAsStable(transaction.transaction_id))
                                                 .then(() => transactionRepository.setInputsAsSpend(transaction.transaction_id))
                                                 .then(() => transactionRepository.getTransactionUnstableInputs(transaction.transaction_id))
                                                 .then(inputs => {
                                                     _.each(inputs, input => newTransactions.push({
                                                         transaction_id: input.output_transaction_id,
                                                         repository    : database.getRepository('transaction', input.output_shard_id)
                                                     }));
                                                     transactionUnlock();
                                                     pathAsStableUnlock();
                                                     callback();
                                                 });
                        }, true);
                    });
                }, () => {
                    if (newTransactions.length === 0 || depth >= config.CONSENSUS_VALIDATION_REQUEST_DEPTH_MAX) {
                        console.log('[setPathAsStableFrom] max depth was', depth);
                        return resolve();
                    }
                    dfs(newTransactions, depth + 1);
                });
            };
            dfs([
                {
                    transaction_id: transactionID,
                    repository    : this
                }
            ], 0);
        });
    }

    setTransactionAsStable(transactionID) {
        return new Promise((resolve, reject) => {
            this.database.run('UPDATE `transaction` SET stable_date=strftime(\'%s\',\'now\'), is_stable = 1 WHERE transaction_id = ?',
                [transactionID], (err) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve();
                });
        });
    }

    setOutputAsStable(transactionID) {
        return this.updateAllTransactionOutput(transactionID, undefined, ntp.now(), undefined);
    }

    setInputsAsSpend(transactionID) {
        return new Promise((resolve) => {
            this.getTransactionInputs(transactionID)
                .then(inputs => {
                    let outputs = _.map(inputs, input => ({
                        transaction_id : input.output_transaction_id,
                        output_position: input.output_position,
                        output_shard_id: input.output_shard_id
                    }));
                    let now     = ntp.now();
                    async.eachSeries(outputs, (output, callback) => {
                        const transactionOutputRepository = database.getRepository('transaction', output.output_shard_id);
                        if (!transactionOutputRepository) {
                            return callback();
                        }
                        transactionOutputRepository.updateTransactionOutput(output.transaction_id, output.output_position, now, now, undefined)
                                                   .then(() => callback())
                                                   .catch(() => callback());
                    }, () => {
                        resolve();
                    });
                });
        });
    }

    getFreeStableOutput(address) {
        return new Promise((resolve) => {
            this.database.all('SELECT transaction_output.*, `transaction`.transaction_date FROM transaction_output INNER JOIN `transaction` ON `transaction`.transaction_id = transaction_output.transaction_id WHERE address=? and is_spent = 0 and transaction_output.is_stable = 1 and is_double_spend = 0',
                [address], (err, rows) => {
                    resolve(rows);
                });
        });
    }

    getLastTransactionByAddress(address) {
        return new Promise((resolve, reject) => {
            this.database.get(
                'SELECT `transaction`.transaction_date FROM transaction_output INNER JOIN `transaction` on `transaction`.transaction_id = transaction_output.transaction_id ' +
                'WHERE address = ? ORDER BY `transaction`.transaction_date DESC LIMIT 1',
                [address], (err, row) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve(row ? new Date(row.transaction_date * 1000) : undefined);
                }
            );
        });
    }


    getFreeTransactions() {
        return new Promise((resolve, reject) => {
            this.database.all(
                'SELECT * FROM `transaction` where is_parent = 0 ORDER BY RANDOM() LIMIT 2',
                (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve(rows);
                }
            );
        });
    }

    getFreeTransactionsCount() {
        return new Promise((resolve, reject) => {
            this.database.get(
                'SELECT count(*) as count FROM `transaction` where is_parent = 0',
                (err, row) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve(row.count);
                }
            );
        });
    }

    getIncludedTransactionsCount() {
        return new Promise((resolve, reject) => {
            this.database.get(
                'SELECT count(*) as count FROM `transaction` where is_parent = 1',
                (err, row) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve(row.count);
                }
            );
        });
    }

    getTransactionByOffset(offset) {
        return new Promise(resolve => {
            this.database.get(
                'SELECT * FROM `transaction` LIMIT 1 OFFSET ' + offset,
                (err, row) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve(row);
                }
            );
        });
    }

    getStableTransactionsCount() {
        return new Promise((resolve, reject) => {
            this.database.get(
                'SELECT count(*) as count FROM `transaction` where is_stable = 1',
                (err, row) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve(row.count);
                }
            );
        });
    }

    getPendingTransactionsCount() {
        return new Promise((resolve, reject) => {
            this.database.get(
                'SELECT count(*) as count FROM `transaction` where is_stable = 0',
                (err, row) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve(row.count);
                }
            );
        });
    }

    getInputsCount() {
        return new Promise((resolve, reject) => {
            this.database.get(
                'SELECT count(*) as count FROM transaction_input',
                (err, row) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve(row.count);
                }
            );
        });
    }

    getOutputsCount() {
        return new Promise((resolve, reject) => {
            this.database.get(
                'SELECT count(*) as count FROM transaction_output',
                (err, row) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve(row.count);
                }
            );
        });
    }

    getOutputSpendDate(outputTransactionID, outputPosition) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT `transaction`.transaction_date FROM transaction_input INNER JOIN `transaction` on transaction_input.transaction_id = `transaction`.transaction_id ' +
                              'WHERE output_transaction_id = ? and output_position = ?', [
                    outputTransactionID,
                    outputPosition
                ],
                (err, row) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve(row ? new Date(row.transaction_date * 1000) : null);
                }
            );
        });
    }

    getOutput(outputTransactionID, outputPosition) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT * FROM transaction_input where output_transaction_id = ? and output_position = ?', [
                    outputTransactionID,
                    outputPosition
                ],
                (err, row) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve(row);
                }
            );
        });
    }

    getTransactionParentDate(transactionID) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT transaction_date FROM transaction_parent INNER JOIN `transaction` on transaction_parent.transaction_id_child = `transaction`.transaction_id ' +
                              'WHERE transaction_id_parent = ?',
                [transactionID], (err, row) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve(row ? new Date(row.transaction_date * 1000) : null);
                }
            );
        });
    }

    getTransaction(transactionID) {
        return new Promise((resolve, reject) => {
            this.database.get(
                'SELECT * FROM `transaction` where transaction_id = ?',
                [transactionID], (err, row) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }

                    if (row) {
                        row.transaction_date = new Date(row.transaction_date * 1000);
                    }

                    resolve(row);
                }
            );
        });
    }

    listTransactions(where, orderBy, limit, shardID) {
        return new Promise((resolve, reject) => {
            let {sql, parameters} = Database.buildQuery('SELECT * FROM `transaction`', where, orderBy, limit, shardID);
            this.database.all(
                sql,
                parameters, (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }

                    if (rows) {
                        _.map(rows, row => row.transaction_date = new Date(row.transaction_date * 1000));
                    }

                    resolve(rows);
                }
            );
        });
    }

    hasTransaction(transactionID) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT EXISTS(select transaction_id from audit_point where transaction_id = ?) as transaction_exists',
                [transactionID], (err, row) => {
                    if (err) {
                        console.log(err);
                        return reject();
                    }
                    let isAuditPoint = row.transaction_exists === 1;
                    this.database.get('SELECT EXISTS(select transaction_id from `transaction` where transaction_id = ?) as transaction_exists',
                        [transactionID], (err, row) => {
                            if (err) {
                                console.log(err);
                                return reject();
                            }
                            let hasTransactionData = row.transaction_exists === 1;
                            let transactionExists  = isAuditPoint || hasTransactionData;
                            resolve([
                                transactionExists,
                                isAuditPoint,
                                hasTransactionData
                            ]);
                        });
                });
        });
    }

    timeoutTransaction(transactionID) {
        return new Promise((resolve, reject) => {
            mutex.lock(['transaction'], unlock => {
                if (true) { //TODO: enable transaction timeout
                    unlock();
                    return resolve();
                }

                this.database.run('BEGIN TRANSACTION', function(err) {
                    if (err) {
                        reject(err);
                        return unlock();
                    }

                    this.database.run('DELETE FROM transaction_input WHERE transaction_id = ?', transactionID, (err) => {
                        err && console.log('[Database] Failed timeout input. [message] ', err);
                        this.database.run('DELETE FROM transaction_output WHERE transaction_id = ?', transactionID, (err) => {
                            err && console.log('[Database] Failed timeout output. [message] ', err);
                            this.database.run('DELETE FROM transaction_signature WHERE transaction_id = ?', transactionID, (err) => {
                                err && console.log('[Database] Failed timeout signature. [message] ', err);
                                this.database.run('DELETE FROM audit_verification WHERE transaction_id = ?', transactionID, (err) => {
                                    err && console.log('[Database] Failed timeout audit verification. [message] ', err);
                                    this.database.run('UPDATE `transaction` SET timeout_date=strftime(\'%s\',\'now\'), is_timeout = 1, stable_date=strftime(\'%s\',\'now\'), is_stable = 1 WHERE transaction_id = ?', transactionID, (err) => {
                                        err && console.log('[Database] Failed timeout transaction. [message] ', err);
                                        this.database.run('COMMIT', (err) => {
                                            err && console.log('[Database] Failed commiting transaction. [message] ', err);
                                            resolve();
                                            unlock();
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    }
}
