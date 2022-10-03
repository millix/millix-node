import console from '../../core/console';
import {Database} from '../database';
import _ from 'lodash';

export default class Keychain {
    constructor(database) {
        this.database                = database;
        this.normalizationRepository = null;
    }

    setNormalizationRepository(repository) {
        this.normalizationRepository = repository;
    }

    addAddress(walletID, isChange, addressPosition, addressBase, addressVersion, addressKeyIdentifier, addressAttribute, status = 1) {
        let address = addressBase + addressVersion + addressKeyIdentifier;

        return new Promise((resolve, reject) => {
            this.database.serialize(() => {
                let errKeychain, errKeychainAddress;
                this.database.run( // IGNORE in case the address was already generated
                    'INSERT INTO keychain (wallet_id, is_change, address_position, address_base, status) VALUES (?,?,?,?,?)',
                    [
                        walletID,
                        isChange,
                        addressPosition,
                        addressBase,
                        status
                    ],
                    err => errKeychain = err);

                this.database.run('INSERT INTO keychain_address(address, address_base, address_version, address_key_identifier, status) VALUES(?,?,?,?,?)',
                    [
                        address,
                        addressBase,
                        addressVersion,
                        addressKeyIdentifier,
                        status
                    ],
                    err => errKeychainAddress = err);

                const attributeEntries = Object.entries(addressAttribute);
                for (let i = 0; i < attributeEntries.length; i++) {
                    let [attributeName, attributeValue] = attributeEntries[i];
                    let attributeTypeID                 = this.normalizationRepository.get(attributeName);
                    if (!attributeTypeID) {
                        return reject('[keychain] attribute type id not found');
                    }
                    let callback = (i === attributeEntries.length - 1) ? () => {
                        if (errKeychain && errKeychainAddress) {
                            console.log(errKeychain.message + ' ' + errKeychainAddress.message);
                            return reject(errKeychainAddress);
                        }
                        resolve({
                            address,
                            wallet_id             : walletID,
                            address_base          : addressBase,
                            address_version       : addressVersion,
                            address_key_identifier: addressKeyIdentifier,
                            is_change             : isChange,
                            address_position      : addressPosition,
                            address_attribute     : addressAttribute
                        });
                    } : () => {
                    };
                    this.database.run('INSERT INTO address_attribute (address_base, address_attribute_type_id, value) VALUES (?,?,?)', [
                        addressBase,
                        attributeTypeID,
                        attributeValue
                    ], callback);
                }
            });
        });
    }

    getNextAddressPosition(walletID) {
        return new Promise((resolve, reject) => {
            this.database.get( // IGNORE in case the address was already generated
                'SELECT MAX(address_position) as address_position FROM keychain WHERE wallet_id=?', [walletID],
                (err, row) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }
                    resolve(row.address_position !== undefined ? row.address_position + 1 : undefined);
                }
            );
        });
    }

    _processAddressList(rows) {
        let addresses = {};
        rows.forEach(row => {
            let address = addresses[row.address];
            if (!address) {
                address                = _.pick(row, 'wallet_id', 'address', 'address_base', 'address_version', 'address_key_identifier', 'address_position', 'is_change', 'status', 'create_date');
                addresses[row.address] = address;
            }

            if (row.attribute_type) {
                if (!address.address_attribute) {
                    address['address_attribute'] = {};
                }
                address['address_attribute'][row.attribute_type] = row.attribute_value;
            }
        });
        return _.values(addresses);
    }

    _processAddress(rows) {
        let address = undefined;
        rows.forEach(row => {
            if (!address) {
                address = _.pick(row, 'wallet_id', 'address', 'address_base', 'address_version', 'address_key_identifier', 'address_position', 'is_change', 'status', 'create_date');
            }
            else if (address.address !== row.address) {
                throw Error('[keychain] invalid address data');
            }

            if (row.attribute_type) {
                if (!address.address_attribute) {
                    address['address_attribute'] = {};
                }
                address['address_attribute'][row.attribute_type] = row.attribute_value;
            }
        });
        return address;
    }

    getAddresses(addresses) {
        return new Promise((resolve, reject) => {
            this.database.all(
                'SELECT ka.address, ka.address_base, ka.address_version, ka.address_key_identifier, k.wallet_id, k.address_position, k.is_change, ka.create_date, atp.attribute_type, at.value as attribute_value \
                 FROM keychain as k INNER JOIN keychain_address as ka ON k.address_base = ka.address_base \
                 LEFT JOIN address_attribute AS at ON at.address_base = k.address_base \
                 LEFT JOIN address_attribute_type as atp ON atp.address_attribute_type_id = at.address_attribute_type_id \
                 WHERE ka.address IN ( ' + addresses.map(() => '?').join(',') + ' ) ', addresses,
                (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }

                    resolve(this._processAddressList(rows));
                }
            );
        });
    }

    getAddressesByAddressBase(addressBaseList) {
        return new Promise((resolve, reject) => {
            this.database.all(
                'SELECT ka.address, ka.address_base, ka.address_version, ka.address_key_identifier, k.wallet_id, k.address_position, k.is_change, ka.create_date, atp.attribute_type, at.value as attribute_value \
                 FROM keychain as k INNER JOIN keychain_address as ka ON k.address_base = ka.address_base \
                 LEFT JOIN address_attribute AS at ON at.address_base = k.address_base \
                 LEFT JOIN address_attribute_type as atp ON atp.address_attribute_type_id = at.address_attribute_type_id \
                 WHERE ka.address_base IN ( ' + addressBaseList.map(() => '?').join(',') + ' ) ', addressBaseList,
                (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }

                    resolve(this._processAddressList(rows));
                }
            );
        });
    }

    getAddress(address) {
        return new Promise((resolve, reject) => {
            this.database.all(
                'SELECT ka.address, ka.address_base, ka.address_version, ka.address_key_identifier, k.wallet_id, k.address_position, k.is_change, ka.status, ka.create_date, atp.attribute_type, at.value as attribute_value \
                 FROM keychain as k INNER JOIN keychain_address as ka ON k.address_base = ka.address_base \
                 LEFT JOIN address_attribute AS at ON at.address_base = k.address_base \
                 LEFT JOIN address_attribute_type as atp ON atp.address_attribute_type_id = at.address_attribute_type_id \
                 WHERE ka.address = ?', [address],
                (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }

                    resolve(this._processAddress(rows));
                }
            );
        });
    }

    activateAndGetNextAddress(walletId) {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT ka.address, ka.address_base, ka.address_version, ka.address_key_identifier, k.wallet_id, k.address_position, k.is_change, ka.status, ka.create_date, atp.attribute_type, at.value as attribute_value \
            FROM keychain as k INNER JOIN keychain_address as ka ON k.address_base = ka.address_base \
            LEFT JOIN address_attribute AS at ON at.address_base = k.address_base \
            LEFT JOIN address_attribute_type as atp ON atp.address_attribute_type_id = at.address_attribute_type_id \
            WHERE ka.status = 0 AND k.wallet_id=? ORDER BY k.address_position LIMIT 1', [walletId],
                (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }

                    const nextAddress = this._processAddressList(rows)[0];

                    if (!nextAddress) {
                        return reject();
                    }

                    this.database.run('UPDATE keychain_address SET status = 1 WHERE address_base = ?', [nextAddress.address_base],
                        (err) => {
                            if (err) {
                                return reject(err);
                            }

                            this.database.run('UPDATE keychain SET status = 1 WHERE address_base = ?', [nextAddress.address_base],
                                (err) => {
                                    if (err) {
                                        return reject(err);
                                    }
                                });

                            nextAddress.status = 1;
                            resolve(nextAddress);
                        });
                }
            );
        });
    }

    getWalletDefaultKeyIdentifier(walletID) {
        return new Promise(resolve => {
            this.database.get('SELECT address_base as address_key_identifier FROM keychain WHERE wallet_id = ? AND is_change=0 AND address_position=0', [walletID], (err, row) => {
                return resolve(row ? row.address_key_identifier : null);
            });
        });
    }

    getWalletKnownKeyIdentifier() {
        return new Promise(resolve => {
            this.database.all('SELECT DISTINCT  address_base as address_key_identifier FROM keychain WHERE is_change=0 AND address_position=0', (err, rows) => {
                return resolve(rows ? new Set(_.map(rows, row => row.address_key_identifier)) : new Set());
            });
        });
    }

    getWalletAddresses(walletID) {
        return new Promise((resolve, reject) => {
            this.database.all(
                'SELECT ka.address, ka.address_base, ka.address_version, ka.address_key_identifier, k.wallet_id, k.address_position, k.is_change, k.create_date, atp.attribute_type, at.value as attribute_value \
                 FROM keychain as k INNER JOIN keychain_address as ka ON k.address_base = ka.address_base \
                 LEFT JOIN address_attribute AS at ON at.address_base = k.address_base \
                 LEFT JOIN address_attribute_type as atp ON atp.address_attribute_type_id = at.address_attribute_type_id \
                 WHERE k.wallet_id = ?', [walletID],
                (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }

                    resolve(this._processAddressList(rows));
                }
            );
        });
    }

    listWalletAddresses(where, orderBy, limit) {
        return new Promise((resolve, reject) => {
            const {
                      sql,
                      parameters
                  } = Database.buildQuery('SELECT ka.address, ka.address_base, ka.address_version, ka.address_key_identifier, k.wallet_id, k.address_position, k.is_change, ka.status, ka.create_date, atp.attribute_type, at.value as attribute_value \
                 FROM keychain as k INNER JOIN keychain_address as ka ON k.address_base = ka.address_base \
                 LEFT JOIN address_attribute AS at ON at.address_base = k.address_base \
                 LEFT JOIN address_attribute_type as atp ON atp.address_attribute_type_id = at.address_attribute_type_id', where, 'ka.' + orderBy, limit);
            this.database.all(
                sql, parameters,
                (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }

                    resolve(this._processAddressList(rows));
                }
            );
        });
    }

}
