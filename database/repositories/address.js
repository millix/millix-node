import _ from 'lodash';
import config from '../../core/config/config';
import {Database} from '../database';
import console from '../../core/console';

export default class Address {
    constructor(database) {
        this.database                = database;
        this.addressVersionList      = [];
        this.supportedVersionSet     = new Set();
        this.normalizationRepository = null;
    }

    setNormalizationRepository(repository) {
        this.normalizationRepository = repository;
    }

    loadAddressVersion() {
        return new Promise(resolve => {
            this.database.all('SELECT * FROM address_version WHERE is_main_network = ?',
                [config.MODE_TEST_NETWORK ? 0 : 1], (err, data) => {
                    if (err) {
                        resolve();
                    }
                    _.each(data, version => {
                        this.addressVersionList.push(version);
                        this.supportedVersionSet.add(version.version);
                    });
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
            if (isDefault === false) {
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
                                parameters, (err, row) => {
                                    this.addressVersionList.push(row);
                                    this.supportedVersionSet.add(row.version);
                                });
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
                    this.supportedVersionSet.delete(version);
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

        throw new Error('address version not supported ' + addressFull);
    }

    addAddress(address, addressBase, addressVersion, addressKeyIdentifier, addressAttribute) {
        return new Promise((resolve) => {
            this.database.serialize(() => {
                this.database.run('INSERT INTO address (address, address_base, address_version, address_key_identifier) VALUES (?,?,?,?)', [
                    address,
                    addressBase,
                    addressVersion,
                    addressKeyIdentifier
                ], !addressAttribute ? () => resolve() : () => {
                });

                if (!addressAttribute) {
                    return;
                }

                const attributeEntries = Object.entries(addressAttribute);
                for (let i = 0; i < attributeEntries.length; i++) {
                    let [attributeName, attributeValue] = attributeEntries[i];
                    let attributeTypeID                 = this.normalizationRepository.get(attributeName);
                    this.database.run('INSERT INTO address_attribute (address_base, address_attribute_type_id, value) VALUES (?,?,?)', [
                        addressBase,
                        attributeTypeID,
                        attributeValue
                    ], (i === attributeEntries.length - 1) ? () => resolve() : () => {
                    });
                }
            });
        });
    }

    getAddressBaseAttribute(addressBase, attributeName) {
        const attributeTypeID = this.normalizationRepository.get(attributeName);
        if (!attributeTypeID) {
            return Promise.reject('[address] attribute not found');
        }

        return new Promise((resolve, reject) => {
            this.database.get('SELECT value FROM address_attribute WHERE address_base = ? AND address_attribute_type_id = ?', [
                    addressBase,
                    attributeTypeID
                ],
                (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(row ? row.value : null);
                });
        });
    }

    getAddressesCount() {
        return new Promise((resolve, reject) => {
            this.database.get(
                'SELECT COUNT(DISTINCT address) AS address_count, COUNT(DISTINCT address_key_identifier) AS address_key_identifier_count FROM address',
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

    listAddress(where, orderBy, limit) {
        return new Promise((resolve, reject) => {

            let {sql, parameters} = Database.buildQuery('SELECT address.*, atp.attribute_type, at.value as attribute_value FROM address  \
                LEFT JOIN address_attribute AS at ON at.address_base = address.address_base \
                LEFT JOIN address_attribute_type as atp ON atp.address_attribute_type_id = at.address_attribute_type_id', where, orderBy, limit);
            this.database.all(
                sql,
                parameters,
                (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    let addresses = {};
                    rows.forEach(row => {
                        let address = addresses[row.address];
                        if (!address) {
                            address                = _.pick(row, 'address', 'address_base', 'address_version', 'address_key_identifier', 'status', 'create_date');
                            addresses[row.address] = address;
                        }

                        if (row.attribute_type) {
                            if (!address.address_attribute) {
                                address['address_attribute'] = {};
                            }
                            address['address_attribute'][row.attribute_type] = row.attribute_value;
                        }
                    });
                    resolve(_.values(addresses));
                }
            );
        });
    }

    listAddressAttribute(where, orderBy, limit) {
        return new Promise((resolve, reject) => {
            let {sql, parameters} = Database.buildQuery('SELECT * FROM address_attribute', where, orderBy, limit);
            this.database.all(
                sql,
                parameters,
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
}
