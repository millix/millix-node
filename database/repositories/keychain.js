import console from '../../core/console';
import {Database} from '../database';
import _ from 'lodash';

export default class Keychain {
    constructor(database) {
        this.database = database;
    }

    addAddress(walletID, isChange, addressPosition, addressBase, addressVersion, addressKeyIdentifier, addressAttribute) {
        let address = addressBase + addressVersion + addressKeyIdentifier;

        return new Promise((resolve, reject) => {
            this.database.run( // IGNORE in case the address was already generated
                'INSERT INTO keychain (wallet_id, is_change, address_position, address_base, address_attribute) VALUES (?,?,?,?,?)',
                [
                    walletID,
                    isChange,
                    addressPosition,
                    addressBase,
                    JSON.stringify(addressAttribute)
                ],
                (errKeychain) => {
                    this.database.run('INSERT INTO keychain_address(address, address_base, address_version, address_key_identifier) VALUES(?,?,?,?)',
                        [
                            address,
                            addressBase,
                            addressVersion,
                            addressKeyIdentifier
                        ],
                        (errKeychainAddress) => {
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
                        });
                }
            );
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
                    resolve(row.address_position + 1);
                }
            );
        });
    }

    getAddress(address) {
        return new Promise((resolve, reject) => {
            this.database.get(
                'SELECT ka.address, ka.address_base, ka.address_version, ka.address_key_identifier, k.wallet_id, k.address_position, k.address_attribute, k.is_change, ka.create_date \
                 FROM keychain as k INNER JOIN keychain_address as ka ON k.address_base = ka.address_base WHERE ka.address = ?', [address],
                (err, row) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }

                    row['address_attribute'] = JSON.parse(row.address_attribute);

                    resolve(row);
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
                'SELECT ka.address, ka.address_base, ka.address_version, ka.address_key_identifier, k.wallet_id, k.address_position, k.address_attribute, k.is_change \
                 FROM keychain as k INNER JOIN keychain_address as ka ON k.address_base = ka.address_base WHERE k.wallet_id = ?', [walletID],
                (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }

                    rows.forEach(r => {
                        r['address_attribute'] = JSON.parse(r.address_attribute);
                    });

                    resolve(rows);
                }
            );
        });
    }

    listWalletAddresses(where, orderBy, limit) {
        return new Promise((resolve, reject) => {
            const {sql, parameters} = Database.buildQuery('SELECT ka.address, ka.address_base, ka.address_version, ka.address_key_identifier, k.wallet_id, k.address_position, k.address_attribute, k.is_change, ka.create_date \
                 FROM keychain as k INNER JOIN keychain_address as ka ON k.address_base = ka.address_base', where, 'ka.' + orderBy, limit);
            this.database.all(
                sql, parameters,
                (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }

                    rows.forEach(r => {
                        r['address_attribute'] = JSON.parse(r.address_attribute);
                    });

                    resolve(rows);
                }
            );
        });
    }

}
