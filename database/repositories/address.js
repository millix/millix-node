import _ from 'lodash';
import async from 'async';
import config from '../../core/config/config';
import {Database} from '../database';

export default class Address {
    constructor(database) {
        this.database           = database;
        this.addressVersionList = [];
    }

    loadAddressVersion() {
        return new Promise(resolve => {
            this.database.all('SELECT * FROM address_version WHERE is_main_network = ?',
                [config.MODE_TEST_NETWORK ? 0 : 1], (err, data) => {
                    if (err) {
                        resolve();
                    }
                    _.each(data, version => this.addressVersionList.push(version));
                    resolve();
                });
        });
    }

    listAddressVersion() {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT * FROM address_version', (err, rows) => {
                if (err) {
                    return reject();
                }
                resolve(rows);
            });
        });
    }

    getDefaultAddressVersion() {

        if (!this.addressVersionList || this.addressVersionList.length === 0) {
            throw Error('no address version defined');
        }

        const addressNetworkFilter = config.MODE_TEST_NETWORK ? 0 : 1;
        for (let i = 0; i < this.addressVersionList.length; i++) {
            const addressVersion = this.addressVersionList[i];
            if (addressVersion.is_main_network === addressNetworkFilter && addressVersion.is_default === 1) {
                return addressVersion;
            }
        }

        // return the first address
        return this.addressVersionList[0];
    }

    addAddressVersion(version, isMainNetwork, regexPattern, isDefault) {
        return new Promise(resolveUpdate => {
            if (isDefault === 0) {
                return resolveUpdate();
            }

            this.database.run('UPDATE address_version SET is_default = 0',
                () => {
                    resolveUpdate();
                });

        }).then(() => {
            return new Promise((resolve, reject) => {
                const parameters = [
                    version,
                    isMainNetwork,
                    regexPattern,
                    isDefault
                ];
                this.database.all('INSERT INTO address_version (version, is_main_network, regex_pattern, is_default) VALUES (?,?,?,?)',
                    parameters, (err) => {
                        if (err) {
                            return reject();
                        }
                        if (config.MODE_TEST_NETWORK && !isMainNetwork || !config.MODE_TEST_NETWORK && isMainNetwork) {
                            this.database.get('SELECT * from address_version WHERE version=? AND is_main_network=? AND regex_pattern=? AND is_default=?',
                                parameters, (err, row) => this.addressVersionList.push(row));
                        }
                        resolve();
                    });
            });
        });
    }

    removeAddressVersion(version) {
        return new Promise(resolve => {
            this.database.all('DELETE FROM address_version WHERE version = ?',
                [version], (err) => {
                    if (err) {
                        return resolve();
                    }
                    const oldList                  = this.addressVersionList.slice();
                    this.addressVersionList.length = 0; // empty the list
                    _.each(oldList, addressVersion => {
                        if (addressVersion.version === version) {
                            return;
                        }
                        this.addressVersionList.push(addressVersion);
                    });
                    resolve();
                });
        });
    }

    getAddressComponent(addressFull) {
        addressFull = addressFull.trim();
        for (let addressVersion of this.addressVersionList) {
            const matches = addressFull.match(new RegExp(addressVersion.regex_pattern));
            if (!matches || !matches.groups['address'] || !matches.groups['version'] || !matches.groups['identifier']) {
                continue;
            }
            const address    = matches.groups['address'];
            const version    = matches.groups['version'];
            const identifier = matches.groups['identifier'];
            return {
                address,
                version,
                identifier
            };
        }

        throw new Error('address version not supported');
    }

    setTransactionRepository(repository) {
        this.transactionRepository = repository;
    }

    addAddress(address, addressBase, addressVersion, addressKeyIdentifier, addressAttribute) {
        addressAttribute = JSON.stringify(addressAttribute);
        return new Promise((resolve) => {
            this.database.run('INSERT INTO address (address, address_base, address_version, address_key_identifier, address_attribute) VALUES (?,?,?,?,?)', [
                address,
                addressBase,
                addressVersion,
                addressKeyIdentifier,
                addressAttribute
            ], (err) => {
                if (err && addressAttribute) {
                    this.database.run('UPDATE address SET address_attribute = ? WHERE address = ?', [
                        addressAttribute,
                        address
                    ], () => {
                        resolve();
                    });
                    return;
                }
                resolve();
            });
        });
    }

    getAddressBaseAttribute(addressBase) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT address_attribute FROM address WHERE address_base = ?', [addressBase],
                (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    row['address_attribute'] = JSON.parse(row.address_attribute);
                    resolve(row);
                });
        });
    }

    getAddressesAttribute(addresses) {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT * FROM address WHERE address in ( ' + addresses.map(() => '?').join(',') + ' )', addresses,
                (err, rows) => {
                    if (err) {
                        return reject(err);
                    }
                    _.each(rows, row => row['address_attribute'] = JSON.parse(row.address_attribute));
                    resolve(rows);
                });
        });
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

                            this.transactionRepository.getTransactionIncludePaths(row.transaction_id)
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

    getAddressesCount() {
        return new Promise((resolve, reject) => {
            this.database.get(
                'SELECT count(*) as count FROM address',
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

    listAddress(where, orderBy, limit) {
        return new Promise((resolve, reject) => {

            let {sql, parameters} = Database.buildQuery('SELECT * FROM address', where, orderBy, limit);
            this.database.all(
                sql,
                parameters,
                (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    _.map(rows, row => row.address_attribute = JSON.parse(row.address_attribute));
                    resolve(rows);
                }
            );
        });
    }
}
