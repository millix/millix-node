import Mnemonic from 'bitcore-mnemonic';
import Bitcore from 'bitcore-lib';
import crypto from 'crypto';
import config from '../config/config';
import fs from 'fs';
import path from 'path';
import base58 from 'bs58';
import os from 'os';
import forge from 'node-forge';
import async from 'async';
import _ from 'lodash';
import network from '../../net/network';


class WalletUtils {
    constructor() {

    }

    // derives for wallet's private or public key
    deriveAddressFromKey(key, isChange, addressPosition) {
        const addressKeyPublicBuffer = this.derivePubkey(key, 'm/' + isChange + '/' + addressPosition);
        const address                = this.getAddressFromPublicKey(addressKeyPublicBuffer);
        const addressAttribute       = {key_public: base58.encode(addressKeyPublicBuffer)};
        return {
            address,
            address_attribute: addressAttribute
        };
    }

    getAddressFromPublicKey(addressKeyPublicBuffer) {
        const hash            = crypto.createHash('sha256').update(addressKeyPublicBuffer).digest();
        const encryptedPubKey = (config.MODE_TEST_NETWORK ? '6f' : '00') + crypto.createHash('ripemd160').update(hash).digest('hex');
        let checksum          = crypto.createHash('sha256').update(encryptedPubKey, 'hex').digest();
        checksum              = crypto.createHash('sha256').update(checksum).digest('hex').substring(0, 8);
        let hexAddress        = encryptedPubKey + checksum;
        return base58.encode(Buffer.from(hexAddress, 'hex'));
    }

    isValidAddress(address) {

        if (!config.MODE_TEST_NETWORK && !address.startsWith('1')) { // check if valid main net address
            return false;
        }
        else if (config.MODE_TEST_NETWORK && address.startsWith('1')) { // check if valid main testnet address
            return false;
        }

        let addressHex      = base58.decode(address).toString('hex');
        let addressChecksum = addressHex.substring(addressHex.length - 8);
        let encryptedPubKey = addressHex.substring(0, addressHex.length - 8);
        let checksum        = crypto.createHash('sha256').update(encryptedPubKey, 'hex').digest();
        checksum            = crypto.createHash('sha256').update(checksum).digest('hex').substring(0, 8);
        return checksum === addressChecksum;
    }

    derivePubkey(key, path) {
        const hdPubKey = new Bitcore.HDPublicKey(key);
        return hdPubKey.derive(path).publicKey.toBuffer();
    }

    deriveWalletFromKey(key) {
        const xPubKey = Bitcore.HDPublicKey(key).toString();
        const wallet  = crypto.createHash('sha256').update(xPubKey, 'utf8').digest('base64');
        return wallet;
    }

    deriveExtendedPrivateKey(xPrivKey, account) {
        return xPrivKey.derive(44, true).derive(0x1EE7, true).derive(account, true);
    }

    derivePrivateKey(extendedPrivateKey, isChange, addressPosition) {
        const privateKey = extendedPrivateKey.derive(isChange, false).derive(addressPosition, false).privateKey;
        return privateKey.toBuffer({size: 32});
    }

    newMnemonic() {
        let mnemonic = new Mnemonic(256); // generates new mnemonic
        while (!Mnemonic.isValid(mnemonic.toString())) {
            mnemonic = new Mnemonic(256);
        }
        return mnemonic;
    }

    loadMnemonic() {
        console.log(path.join(os.homedir(), config.KEY_PATH));
        return new Promise((resolve, reject) => {
            fs.readFile(path.join(os.homedir(), config.KEY_PATH), 'utf8', (err, data) => {
                if (err) {
                    return reject('Couldn\'t read wallet mnemonic');
                }

                const keys = JSON.parse(data);
                if (keys.mnemonic_phrase) {
                    return resolve([
                        keys.mnemonic_phrase,
                        keys.mnemonic_new === true
                    ]);
                }
                else {
                    return reject('Couldn\'t read nor create master key');
                }
            });
        });
    }

    storeMnemonic(mnemonic_phrase, mnemonic_new) {
        return new Promise((resolve, reject) => {
            const keys = {
                mnemonic_phrase,
                mnemonic_new
            };
            fs.writeFile(path.join(os.homedir(), config.KEY_PATH), JSON.stringify(keys, null, '\t'), 'utf8', function(err) {
                if (err) {
                    return reject('failed to write keys file');
                }
                resolve(mnemonic_phrase);
            });
        });
    }

    removeMnemonic() {
        return new Promise(resolve => {
            fs.unlink(path.join(os.homedir(), config.KEY_PATH), function() {
                resolve();
            });
        });
    }


    generateNodeKey() {
        const mnemonic = this.newMnemonic();
        return mnemonic.toHDPrivateKey(crypto.randomBytes(20).toString('hex'));
    }

    publicKeyFromPem(publicKey) {
        return forge.pki.publicKeyFromPem('-----BEGIN PUBLIC KEY-----\n' + publicKey + '\n-----END PUBLIC KEY-----');
    }

    isValidNodeSignature(signature, message, publicKey) {
        const md = forge.md.sha1.create();
        md.update(message, 'utf8');
        return publicKey.verify(md.digest().bytes(), base58.decode(signature));
    }

    getNodeIdFromPublicKey(publicKey) {
        return forge.pki.getPublicKeyFingerprint(publicKey, {
            encoding : 'hex',
            delimiter: ''
        });
    }

    loadNodeKeyAndCertificate() {
        const pki = forge.pki;
        return new Promise((resolve, reject) => {
            const elements = [
                {
                    file       : path.join(os.homedir(), config.NODE_PRIVATE_KEY_PATH),
                    transformer: pki.privateKeyFromPem,
                    key        : 'private_key'
                },
                {
                    file       : path.join(os.homedir(), config.NODE_PUBLIC_KEY_PATH),
                    transformer: pki.publicKeyFromPem,
                    key        : 'public_key'
                },
                {
                    file       : path.join(os.homedir(), config.NODE_CERTIFICATE_PATH),
                    transformer: pki.certificateFromPem,
                    key        : 'certificate'
                }
            ];
            async.mapSeries(elements, (element, callback) => {
                fs.readFile(element.file, 'utf8', function(err, pemData) {
                    if (err) {
                        return callback(true);
                    }
                    try {
                        const obj = element.transformer(pemData);
                        return callback(false, {
                            [element.key]         : obj,
                            [element.key + '_pem']: pemData
                        });
                    }
                    catch (e) {
                        return callback(true);
                    }
                });
            }, (error, data) => {
                if (!error) {
                    data            = _.reduce(data, (obj, item) => ({...obj, ...item}));
                    data['node_id'] = pki.getPublicKeyFingerprint(data.public_key, {
                        encoding : 'hex',
                        delimiter: ''
                    });
                    return resolve(data);
                }
                else {
                    const keys              = pki.rsa.generateKeyPair(1024);
                    const cert              = pki.createCertificate();
                    cert.publicKey          = keys.publicKey;
                    cert.serialNumber       = '01';
                    cert.validity.notBefore = new Date();
                    cert.validity.notAfter  = new Date();
                    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 50);
                    const attrs = [
                        {
                            shortName: 'CN',
                            value    : 'millix.org'
                        },
                        {
                            shortName: 'C',
                            value    : 'millix network public'
                        },
                        {
                            shortName: 'ST',
                            value    : 'millix network'
                        },
                        {
                            shortName: 'L',
                            value    : 'internet'
                        },
                        {
                            shortName: 'O',
                            value    : 'millix foundation'
                        },
                        {
                            shortName: 'OU',
                            value    : 'millix node unit'
                        }
                    ];
                    cert.setSubject(attrs);
                    cert.setIssuer(attrs);
                    cert.setExtensions([
                        {
                            name: 'basicConstraints',
                            cA  : true
                        },
                        {
                            name            : 'keyUsage',
                            keyCertSign     : true,
                            digitalSignature: true,
                            nonRepudiation  : true,
                            keyEncipherment : true,
                            dataEncipherment: true
                        },
                        {
                            name           : 'extKeyUsage',
                            serverAuth     : true,
                            clientAuth     : true,
                            codeSigning    : true,
                            emailProtection: true,
                            timeStamping   : true
                        },
                        {
                            name   : 'nsCertType',
                            client : true,
                            server : true,
                            email  : true,
                            objsign: true,
                            sslCA  : true,
                            emailCA: true,
                            objCA  : true
                        },
                        {
                            name: 'subjectKeyIdentifier'
                        }
                    ]);
                    cert.sign(keys.privateKey);

                    // convert a Forge certificate to PEM
                    const certPem = pki.certificateToPem(cert);

                    const privateKeyPem = pki.privateKeyToPem(keys.privateKey);

                    const publicKeyPem = pki.publicKeyToPem(keys.publicKey);

                    fs.writeFile(path.join(os.homedir(), config.NODE_PRIVATE_KEY_PATH), privateKeyPem, 'utf8', function(err) {
                        if (err) {
                            return reject('failed to write node private key file');
                        }
                        fs.writeFile(path.join(os.homedir(), config.NODE_PUBLIC_KEY_PATH), publicKeyPem, 'utf8', function(err) {
                            if (err) {
                                return reject('failed to write node public file');
                            }
                            fs.writeFile(path.join(os.homedir(), config.NODE_CERTIFICATE_PATH), certPem, 'utf8', function(err) {
                                if (err) {
                                    return reject('failed to write node certificate file');
                                }
                                const nodeID = pki.getPublicKeyFingerprint(keys.publicKey, {
                                    encoding : 'hex',
                                    delimiter: ''
                                });
                                resolve({
                                    private_key    : keys.privateKey,
                                    private_key_pem: privateKeyPem,
                                    public_key     : keys.publicKey,
                                    public_key_pem : publicKeyPem,
                                    certificate    : cert,
                                    certificate_pem: certPem,
                                    node_id        : nodeID
                                });
                            });
                        });
                    });
                }
            });
        });
    }

    loadNodeKey() {
        return new Promise((resolve, reject) => {
            fs.readFile(path.join(os.homedir(), config.NODE_KEY_PATH), 'utf8', function(err, data) {
                if (err) {
                    return reject('couldn\'t read node key');
                }

                const pki = forge.pki;

                try {
                    return resolve(pki.privateKeyFromPem(data));
                }
                catch (e) {
                    return reject('couldn\'t read node key');
                }
            });
        });
    }

    storeNodeKey(key) {
        return new Promise((resolve, reject) => {
            fs.writeFile(path.join(os.homedir(), config.NODE_KEY_PATH), JSON.stringify({key: key.toString()}, null, '\t'), 'utf8', function(err) {
                if (err) {
                    return reject('failed to write node key file');
                }
                resolve(key);
            });
        });
    }


}


export default new WalletUtils();
