import Mnemonic from 'bitcore-mnemonic';
import Bitcore from 'bitcore-lib';
import crypto from 'crypto';
import config from '../config/config';
import fs from 'fs';
import path from 'path';
import base58 from 'bs58';
import os from 'os';
import {ASN1HEX, KEYUTIL, KJUR, X509} from 'jsrsasign';
import async from 'async';
import _ from 'lodash';
import database from '../../database/database';
import objectHash from '../crypto/object-hash';
import network from '../../net/network';
import genesisConfig from '../genesis/genesis-config';
import signature from '../crypto/signature';
import node from '../../database/repositories/node';
import {v4 as uuidv4} from 'uuid';
import ntp from '../ntp';


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

    derivePublicKey(extendedPrivateKey, isChange, addressPosition) {
        const publicKey = extendedPrivateKey.derive(isChange, false).derive(addressPosition, false).publicKey;
        return publicKey.toBuffer({size: 32});
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
        console.log(config.WALLET_KEY_PATH);
        return new Promise((resolve, reject) => {
            fs.readFile(config.WALLET_KEY_PATH, 'utf8', (err, data) => {
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
            fs.writeFile(config.WALLET_KEY_PATH, JSON.stringify(keys, null, '\t'), 'utf8', function(err) {
                if (err) {
                    return reject('failed to write keys file');
                }
                resolve(mnemonic_phrase);
            });
        });
    }

    getShardInfo(nodeID, shardDate, shardType, nodePrivateKey) {
        let baseShardInfo     = {
            node_id_origin: nodeID,
            shard_date    : shardDate,
            shard_type    : shardType
        };
        let shardInfo         = {
            ...baseShardInfo,
            node_signature: signature.sign(objectHash.getHashBuffer(baseShardInfo), nodePrivateKey.toBuffer())
        };
        shardInfo['shard_id'] = objectHash.getCHash288(shardInfo);
        return shardInfo;
    }

    removeMnemonic() {
        return new Promise(resolve => {
            fs.unlink(config.WALLET_KEY_PATH, function() {
                resolve();
            });
        });
    }


    generateNodeKey() {
        const mnemonic = this.newMnemonic();
        return mnemonic.toHDPrivateKey(uuidv4());
    }

    getNodeIdFromCertificate(certificateData, type) {
        if (type === 'hex') {
            const certificate = new X509();
            certificate.readCertHex(certificateData);
            return this.getNodeIdFromCertificate(certificate);
        }
        else if (type === 'pem') {
            const certificate = new X509();
            certificate.readCertPEM(certificateData);
            return this.getNodeIdFromCertificate(certificate);
        }
        else {
            const certificate = certificateData;
            if (!certificate.verifySignature(certificate.getPublicKey()) ||
                !this._verifyTBSCertificate(certificate)) {
                throw Error('invalid node certificate');
            }

            const nodeIDInfo = certificate.getExtInfo('1.3.6.1.5.5.7.1.24.2');
            if (nodeIDInfo === undefined) {
                return null;
            }
            const nodeIDHex = ASN1HEX.getV(certificate.hex, nodeIDInfo.vidx);
            return Buffer.from(nodeIDHex, 'hex').toString('utf8');
        }
    }

    /**
     * get node id from the certificate
     * @param certificate
     * @return {boolean|boolean|undefined}
     */
    getNodePublicKeyFromCertificate(certificateData, type) {
        if (type === 'hex') {
            const certificate = new X509();
            certificate.readCertHex(certificateData);
            return this.getNodePublicKeyFromCertificate(certificate);
        }
        else if (type === 'pem') {
            const certificate = new X509();
            certificate.readCertPEM(certificateData);
            return this.getNodePublicKeyFromCertificate(certificate);
        }
        else {
            const certificate = certificateData;
            let nodePublicKey;
            try {
                let tbsHex      = ASN1HEX.getV(certificate.hex, 0, [0], '03');
                const idxExtSeq = ASN1HEX.getIdxbyList(tbsHex, 0, [
                    7,
                    0
                ], '30');

                const extIdxList = ASN1HEX.getChildIdx(tbsHex, idxExtSeq);

                if (extIdxList.length < 3) {
                    return false;
                }

                for (let i = 0; i < extIdxList.length - 1; i++) {
                    const idx = extIdxList[i];
                    const oid = ASN1HEX.hextooidstr(ASN1HEX.getVbyList(tbsHex, idx, [0], '06'));
                    if (oid === '1.3.6.1.5.5.7.1.24.1') {
                        const publicKeyBuffer = Buffer.from(ASN1HEX.getVbyList(tbsHex, idx, [
                            1,
                            0
                        ], '03', true), 'hex');
                        nodePublicKey         = base58.encode(publicKeyBuffer);
                        break;
                    }
                }

            }
            catch (e) {
            }
            return nodePublicKey;
        }
    }

    getNodeIdFromPublicKey(publicKey) {
        return this.getAddressFromPublicKey(base58.decode(publicKey));
    }

    isValidNodeIdentity(nodeID, publicKey, message, signature) {
        try {
            return this.verify(publicKey, signature, message) && (this.getNodeIdFromPublicKey(publicKey) === nodeID);
        }
        catch (e) {
            return false;
        }
    }

    signMessage(nodePrivateKey, message) {
        return signature.sign(objectHash.getHashBuffer(message), nodePrivateKey.toBuffer());
    }

    /**
     * verifies if the tbs certificate was associated to the @param nodeID
     * @param certificate
     * @param nodeID
     * @private
     * @return tbscertificate hex string
     */
    _verifyTBSCertificate(certificate) {
        try {
            let tbsHex       = ASN1HEX.getV(certificate.hex, 0, [0], '03');
            const tbsIdxList = ASN1HEX.getChildIdx(tbsHex, 0);

            const idxExtSeq = ASN1HEX.getIdxbyList(tbsHex, 0, [
                7,
                0
            ], '30');

            const extIdxList = ASN1HEX.getChildIdx(tbsHex, idxExtSeq);

            if (extIdxList.length < 3) {
                return false;
            }

            const lastExtensionIdx = extIdxList[extIdxList.length - 1];
            const oid              = ASN1HEX.hextooidstr(ASN1HEX.getVbyList(tbsHex, lastExtensionIdx, [0], '06'));
            if (oid !== '1.3.6.1.5.5.7.1.24.3') {
                return false;
            }
            let sign = ASN1HEX.getVbyList(tbsHex, lastExtensionIdx, [
                1,
                0
            ], '03', true);
            sign     = base58.encode(Buffer.from(sign, 'hex'));

            const extensionsArray = [];
            let publicKeyBuffer, nodeID;
            for (let i = 0; i < extIdxList.length - 1; i++) {
                const idx    = extIdxList[i];
                const extTLV = ASN1HEX.getTLV(tbsHex, idx);
                extensionsArray.push({getEncodedHex: () => extTLV});

                const oid = ASN1HEX.hextooidstr(ASN1HEX.getVbyList(tbsHex, idx, [0], '06'));
                if (oid === '1.3.6.1.5.5.7.1.24.1') {
                    publicKeyBuffer = Buffer.from(ASN1HEX.getVbyList(tbsHex, idx, [
                        1,
                        0
                    ], '03', true), 'hex');
                }
                else if (oid === '1.3.6.1.5.5.7.1.24.2') {
                    nodeID = Buffer.from(ASN1HEX.getVbyList(tbsHex, idx, [
                        1,
                        0
                    ], '0c'), 'hex').toString();
                }
            }
            const extSeq    = new KJUR.asn1.DERSequence({'array': extensionsArray});
            const extTagObj = new KJUR.asn1.DERTaggedObject({
                'explicit': true,
                'tag'     : 'a3',
                'obj'     : extSeq
            });

            const tbsCertificateArray = [];
            for (let i = 0; i < tbsIdxList.length - 1; i++) {
                const idx        = tbsIdxList[i];
                const tbsItemTLV = ASN1HEX.getTLV(tbsHex, idx);
                tbsCertificateArray.push({getEncodedHex: () => tbsItemTLV});
            }
            tbsCertificateArray.push(extTagObj);

            tbsHex     = new KJUR.asn1.DERSequence({'array': tbsCertificateArray}).getEncodedHex();
            const hash = objectHash.getHashBuffer(Buffer.from(tbsHex, 'hex'), true);
            return signature.verify(hash, sign, base58.encode(publicKeyBuffer)) && this.getAddressFromPublicKey(publicKeyBuffer) === nodeID;
        }
        catch (e) {
            return false;
        }
    }

    _getCertificateExtension(oid, valueHex) {
        const extension           = new KJUR.asn1.x509.Extension();
        extension.oid             = oid;
        extension.getExtnValueHex = () => valueHex;
        return extension;
    }

    loadNodeKeyAndCertificate() {
        return new Promise((resolve, reject) => {
            const elements = [
                {
                    file       : config.NODE_CERTIFICATE_KEY_PATH,
                    transformer: KEYUTIL.getKey,
                    key        : 'certificate_private_key'
                },
                {
                    file       : config.NODE_KEY_PATH,
                    transformer: (data) => new Bitcore.HDPrivateKey(data),
                    key        : 'node'
                },
                {
                    file       : config.NODE_CERTIFICATE_PATH,
                    transformer: (pem) => {
                        const x509 = new X509();
                        x509.readCertPEM(pem);
                        return x509;
                    },
                    key        : 'certificate'
                }
            ];
            async.mapSeries(elements, (element, callback) => {
                fs.readFile(element.file, 'utf8', function(err, pemData) {
                    if (err) {
                        return callback(true);
                    }
                    try {
                        if (element.key === 'node') {
                            const data = JSON.parse(pemData);
                            if (data.key) {
                                const obj = element.transformer(data.key);
                                return callback(false, {
                                    [element.key + '_private_key']: obj.privateKey,
                                    [element.key + '_public_key'] : obj.publicKey
                                });
                            }
                            else {
                                return callback(true);
                            }
                        }
                        else {
                            const obj = element.transformer(pemData);
                            return callback(false, {
                                [element.key]         : obj,
                                [element.key + '_pem']: pemData
                            });
                        }
                    }
                    catch (e) {
                        return callback(true);
                    }
                });
            }, (error, data) => {
                if (!error) {
                    return resolve(_.reduce(data, (obj, item) => ({...obj, ...item})));
                }
                else {
                    const ecKeypair = KEYUTIL.generateKeypair('EC', 'secp256r1');

                    // generate TBSCertificate
                    const tbsc = new KJUR.asn1.x509.TBSCertificate();

                    // add basic fields
                    tbsc.setSerialNumberByParam({'int': Date.now()});
                    tbsc.setSignatureAlgByParam({'name': 'SHA1withECDSA'});
                    tbsc.setIssuerByParam({'str': '/C=US/O=millix foundation/CN=mlx/ST=millix network'});
                    tbsc.setNotBeforeByParam({'str': '200504235959Z'});
                    tbsc.setNotAfterByParam({'str': '300504235959Z'});
                    tbsc.setSubjectByParam({'str': '/C=US/O=millix foundation/CN=mlx/ST=millix network'});
                    tbsc.setSubjectPublicKeyByGetKey(ecKeypair.pubKeyObj);
                    // add extensions
                    tbsc.appendExtension(new KJUR.asn1.x509.BasicConstraints({'cA': true}));
                    const subjectKeyIdentifierHex = KJUR.crypto.Util.hashHex(ecKeypair.pubKeyObj.pubKeyHex, 'sha1');
                    tbsc.appendExtension(new KJUR.asn1.x509.SubjectKeyIdentifier({kid: {hex: subjectKeyIdentifierHex}}));
                    tbsc.appendExtension(new KJUR.asn1.x509.AuthorityKeyIdentifier({kid: {hex: subjectKeyIdentifierHex}}));
                    this.loadOrCreateNodeKey().then(nodeKey => {
                        const nodePublicKeyHex = nodeKey.publicKey.toString();
                        const nodeID           = this.getAddressFromPublicKey(nodeKey.publicKey.toBuffer());
                        tbsc.appendExtension(this._getCertificateExtension('1.3.6.1.5.5.7.1.24.1', KJUR.asn1.ASN1Util.newObject({'bitstr': '04' + nodePublicKeyHex}).getEncodedHex()));
                        tbsc.appendExtension(this._getCertificateExtension('1.3.6.1.5.5.7.1.24.2', KJUR.asn1.ASN1Util.newObject({'utf8str': nodeID}).getEncodedHex()));
                        const tbscNodeSignatureHex = signature.sign(objectHash.getHashBuffer(Buffer.from(tbsc.getEncodedHex(), 'hex'), true), nodeKey.privateKey.toBuffer(), 'hex');
                        tbsc.appendExtension(this._getCertificateExtension('1.3.6.1.5.5.7.1.24.3', KJUR.asn1.ASN1Util.newObject({'bitstr': '04' + tbscNodeSignatureHex}).getEncodedHex()));

                        // sign and get PEM certificate with CA private key
                        const certificate = new KJUR.asn1.x509.Certificate({
                            'tbscertobj': tbsc,
                            'prvkeyobj' : ecKeypair.prvKeyObj
                        });
                        certificate.sign();
                        const certificatePem = certificate.getPEMString();

                        const privateKeyPem = KEYUTIL.getPEM(ecKeypair.prvKeyObj, 'PKCS1PRV');

                        fs.writeFile(config.NODE_CERTIFICATE_KEY_PATH, privateKeyPem, 'utf8', function(err) {
                            if (err) {
                                return reject('failed to write node private key file');
                            }
                            fs.writeFile(config.NODE_CERTIFICATE_PATH, certificatePem, 'utf8', function(err) {
                                if (err) {
                                    return reject('failed to write node certificate file');
                                }
                                resolve({
                                    certificate_private_key    : ecKeypair.prvKeyObj,
                                    certificate_private_key_pem: privateKeyPem,
                                    certificate                : certificate,
                                    certificate_pem            : certificatePem,
                                    node_private_key           : nodeKey.privateKey,
                                    node_public_key            : nodeKey.publicKey
                                });
                            });
                        });
                    }).catch(() => reject('failed to create node id file'));
                }
            });
        });
    }

    loadOrCreateNodeKey() {
        return new Promise((resolve, reject) => {
            this.loadNodeKey()
                .then(nodeKey => resolve(nodeKey))
                .catch(() => {
                    const nodeKey = this.generateNodeKey();
                    this.storeNodeKey(nodeKey)
                        .then(() => resolve(nodeKey))
                        .catch(() => reject());
                });
        });
    }

    loadNodeKey() {
        return new Promise((resolve, reject) => {
            fs.readFile(config.NODE_KEY_PATH, 'utf8', function(err, data) {
                if (err) {
                    return reject('couldn\'t read node key');
                }

                try {
                    data = JSON.parse(data);
                    if (data.key) {
                        return resolve(new Bitcore.HDPrivateKey(data.key));
                    }
                }
                catch (e) {
                }

                return reject('couldn\'t read node key');
            });
        });
    }

    storeNodeKey(key) {
        return new Promise((resolve, reject) => {
            fs.writeFile(config.NODE_KEY_PATH, JSON.stringify({key: key.toString()}, null, '\t'), 'utf8', function(err) {
                if (err) {
                    return reject('failed to write node key file');
                }
                resolve(key);
            });
        });
    }

    storeNodeData(extraData) {
        return new Promise((resolve, reject) => {
            fs.readFile(config.NODE_KEY_PATH, 'utf8', function(err, data) {
                if (err) {
                    return reject('couldn\'t the node data file');
                }

                data = {...JSON.parse(data), ...extraData};

                fs.writeFile(config.NODE_KEY_PATH, JSON.stringify(data, null, '\t'), 'utf8', function(err) {
                    if (err) {
                        return reject('failed to write to the node data file');
                    }
                    resolve();
                });

            });
        });
    }

    verifyTransaction(transaction) {
        return new Promise(resolve => {
            if (transaction.transaction_id === genesisConfig.genesis_transaction) {
                return resolve(true);
            }
            if (!this.isValidTransactionObject(transaction)) {
                return resolve(false);
            }

            let transactionDate;
            if (![
                '0a0',
                '0b0',
                'la0l',
                'lb0l'
            ].includes(transaction.version)) {
                transactionDate = new Date(transaction.transaction_date * 1000);
            }
            else {
                transactionDate = new Date(transaction.transaction_date);
            }

            const maxTransactionDate = ntp.now().getTime() + config.TRANSACTION_CLOCK_SKEW_TOLERANCE * 1000;
            if (transactionDate.getTime() >= maxTransactionDate) {
                return resolve(false);
            }
            else if ([
                '0b0',
                '0b10',
                '0b20',
                '0b30',
                'lb0l',
                'lb1l',
                'lb2l',
                'lb3l'
            ].includes(transaction.version)) {
                const isValidRefresh = this.isValidRefreshTransaction(transaction.transaction_input_list, transaction.transaction_output_list);
                if (!(isValidRefresh)) {
                    console.log('[wallet-utils] Rejecting refresh transaction');
                }

                resolve(isValidRefresh);
            }
            else if (transactionDate.getTime() <= 1597838399000) { // old transactions version: before unspent auto-consumption feature.
                resolve(true);
            }
            else {
                // before 1620603935 the refresh time was 3 days
                // now the refresh time is 10 min
                // (TRANSACTION_OUTPUT_EXPIRE_OLDER_THAN)
                const expireMinutes   = transactionDate.getTime() <= 1620603935000 ? 4320 : config.TRANSACTION_OUTPUT_EXPIRE_OLDER_THAN;
                let maximumOldestDate = new Date(transactionDate.getTime());
                maximumOldestDate.setMinutes(maximumOldestDate.getMinutes() - expireMinutes);
                this.isConsumingExpiredOutputs(transaction.transaction_input_list, maximumOldestDate)
                    .then(isConsumingExpired => {
                        resolve(!isConsumingExpired);
                    })
                    .catch(err => {
                        console.log(`[wallet-utils] failed to check if consuming expired. abandoning verification. error: ${err}`);
                        resolve(false);
                    });
            }
        });
    }

    verify(publicKey, sign, message) {
        return signature.verify(objectHash.getHashBuffer(message), sign, publicKey);
    }

    isConsumingExpiredOutputs(inputList, maximumOldestDate) {
        return new Promise(resolve => {
            async.eachSeries(inputList, (input, callback) => {
                let output_shard = input.output_shard_id;

                database.firstShardZeroORShardRepository('transaction', output_shard, transactionRepository => {
                    return transactionRepository.getTransaction(input.output_transaction_id);
                }).then(sourceTransaction => {
                    if (!sourceTransaction) {
                        console.log(`[wallet-utils] Cannot check if parent transaction ${input.output_transaction_id} is expired, since it is not stored`);
                        callback(false);
                    }
                    else {
                        if ((maximumOldestDate - sourceTransaction.transaction_date) > 0) {
                            // Meaning it
                            // consumed an
                            // expired output
                            callback(true);
                        }
                        else {
                            callback(false);
                        }
                    }
                });
            }, (isConsumingExpired) => resolve(isConsumingExpired));
        });
    }

    isValidTransactionObject(transaction) {

        if (!config.WALLET_TRANSACTION_SUPPORTED_VERSION.includes(transaction.version) ||
            transaction.transaction_input_list.length > config.TRANSACTION_INPUT_MAX ||
            transaction.transaction_output_list.length > config.TRANSACTION_OUTPUT_MAX ||
            transaction.transaction_parent_list.length > config.TRANSACTION_PARENT_MAX ||
            transaction.transaction_signature_list.length > config.TRANSACTION_SIGNATURE_MAX) {
            return false;
        }

        let transactionDate;
        if (![
            '0a0',
            '0b0',
            'la0l',
            'lb0l'
        ].includes(transaction.version)) {
            transactionDate = transaction.transaction_date;
        }
        else {
            transactionDate = new Date(transaction.transaction_date).getTime() / 1000;
        }

        const addressRepository                   = database.getRepository('address');
        //sort arrays
        transaction['transaction_output_list']    = _.sortBy(transaction.transaction_output_list, 'output_position');
        transaction['transaction_input_list']     = _.sortBy(transaction.transaction_input_list, 'input_position');
        transaction['transaction_signature_list'] = _.sortBy(transaction.transaction_signature_list, 'address_base');
        //verify addresses
        if (transaction.transaction_id !== genesisConfig.genesis_transaction) {
            const outputUsedInTransaction = new Set();
            for (let i = 0; i < transaction.transaction_input_list.length; i++) {
                const input    = transaction.transaction_input_list[i];
                const outputID = input.output_transaction_id + ':' + input.output_position;
                if (!this.isValidAddress(input.address_base)
                    || !this.isValidAddress(input.address_key_identifier)
                    || !addressRepository.supportedVersionSet.has(input.address_version)
                    || outputUsedInTransaction.has(outputID)
                    || transactionDate < input.output_transaction_date
                    || !_.has(input, 'input_position')
                    || !_.has(input, 'output_position')
                    || !_.has(input, 'output_transaction_date')
                    || !_.has(input, 'output_transaction_id')
                    || !_.has(input, 'output_shard_id')) {
                    return false;
                }
                outputUsedInTransaction.add(outputID);
            }
        }

        for (let i = 0; i < transaction.transaction_output_list.length; i++) {
            const output = transaction.transaction_output_list[i];
            if (!this.isValidAddress(output.address_base)
                || !this.isValidAddress(output.address_key_identifier)
                || !addressRepository.supportedVersionSet.has(output.address_version)) {
                return false;
            }

            try {
                let amount = Math.round(transaction.transaction_output_list[i].amount);
                if (amount <= 0 || amount !== transaction.transaction_output_list[i].amount) {
                    return false;
                }
            }
            catch (e) {
                return false;
            }
        }

        for (let i = 0; i < transaction.transaction_signature_list.length; i++) {
            if (!this.isValidAddress(transaction.transaction_signature_list[i].address_base)) {
                return false;
            }
        }


        // genesis transaction
        if (transaction.transaction_id === genesisConfig.genesis_transaction) {
            transaction['transaction_input_list']  = [
                {
                    type          : 'issue',
                    amount        : config.MILLIX_CIRCULATION,
                    input_position: 0
                }
            ];
            transaction['transaction_parent_list'] = [];
        }

        const omitFields = [
            'payload_hash',
            'transaction_id',
            'transaction_date',
            'node_id_origin',
            'node_id_proxy',
            'shard_id',
            'version'
        ];

        const versionType = transaction.version.charAt(1);
        if (!((versionType === 'a' || versionType === 'b') &&
              parseInt(transaction.version.substring(2, transaction.version.length - 1)) >= 3)) {
            omitFields.push('transaction_output_attribute');
        }

        // verify signature
        let vTransaction = _.cloneDeep(_.omit(transaction, omitFields));

        const addressSignatureList = [];
        for (let i = 0; i < vTransaction.transaction_signature_list.length; i++) {
            let addressSignature = vTransaction.transaction_signature_list[i];
            addressSignatureList.push(addressSignature['signature']);
            delete addressSignature['signature'];
        }

        if (transaction.transaction_id === genesisConfig.genesis_transaction) {
            delete vTransaction['transaction_parent_list'];
        }
        vTransaction['payload_hash']     = objectHash.getCHash288(vTransaction);
        vTransaction['transaction_date'] = transaction.transaction_date;
        vTransaction['node_id_origin']   = transaction.node_id_origin;
        vTransaction['shard_id']         = transaction.shard_id;
        vTransaction['version']          = transaction.version;
        if (transaction.node_id_proxy) {
            vTransaction['node_id_proxy'] = transaction.node_id_proxy;
        }

        for (let i = 0; i < vTransaction.transaction_signature_list.length; i++) {
            const sign              = addressSignatureList[i];
            const signatureVerified = this.verify(vTransaction.transaction_signature_list[i].address_attribute.key_public, sign, vTransaction);
            if (!signatureVerified) {
                return false;
            }
        }

        for (let i = 0; i < vTransaction.transaction_signature_list.length; i++) {
            const sign                                              = addressSignatureList[i];
            vTransaction.transaction_signature_list[i]['signature'] = sign;
        }

        vTransaction['transaction_id'] = objectHash.getCHash288(vTransaction);
        return !(vTransaction['payload_hash'] !== transaction['payload_hash'] || vTransaction['transaction_id'] !== transaction['transaction_id']);
    }

    // Refresh transaction is valid if all inputs and outputs belong to same
    // master private key meaning that their address key identifiers are same
    isValidRefreshTransaction(inputList, outputList) {
        const addressKeyIdentifier = inputList[0].address_key_identifier;

        for (let input of inputList) {
            if (input.address_key_identifier !== addressKeyIdentifier) {
                return false;
            }
        }

        for (let output of outputList) {
            if (output.address_key_identifier !== addressKeyIdentifier) {
                return false;
            }
        }

        return true;
    }

    signTransaction(inputList, outputList, feeOutputList, addressAttributeMap, privateKeyMap, transactionDate, transactionVersion, outputAttributes = {}) {
        if (feeOutputList.length < 1 || !feeOutputList[0].node_id_proxy) {
            // there should be at least one output entry for the proxy (fees).
            return Promise.reject('proxy/output fee information is required');
        }

        const nodeIDProxy = feeOutputList[0].node_id_proxy;
        feeOutputList     = _.filter(feeOutputList, o => o.amount > 0);

        if (!inputList || inputList.length === 0) {
            return Promise.reject('input list is required');
        }

        if (!outputList || outputList.length === 0) {
            return Promise.reject('output list is required');
        }

        if (!privateKeyMap) {
            return Promise.reject('private key set is required');
        }

        let maximumOldestDate = new Date(transactionDate.getTime());
        maximumOldestDate.setMinutes(maximumOldestDate.getMinutes() - config.TRANSACTION_OUTPUT_EXPIRE_OLDER_THAN);

        return new Promise((resolve, reject) => {
            const allocatedFunds = _.sum(_.map(inputList, o => o.amount));
            const amount         = _.sum(_.map(outputList, o => o.amount)) + _.sum(_.map(feeOutputList, o => o.amount));
            if (amount !== allocatedFunds) {
                return reject(`invalid_amount: allocated (${allocatedFunds}), spend (${amount})`);
            }
            resolve();
        }).then(() => new Promise((resolve, reject) => {
            const addressBaseList = _.uniq(_.map(inputList, i => i.address_base));
            const signatureList   = _.map(addressBaseList, addressBase => ({
                address_base     : addressBase,
                address_attribute: addressAttributeMap[addressBase]
            }));
            return resolve(signatureList);
        })).then(signatureList => this.isConsumingExpiredOutputs(inputList, maximumOldestDate).then(isConsumingExpiredOutputs => [
            signatureList,
            isConsumingExpiredOutputs
        ]))
          .then(([signatureList, isConsumingExpiredOutputs]) => {
              let transactionList = [];
              let transaction;
              if (!isConsumingExpiredOutputs) {
                  transaction = {
                      transaction_input_list    : _.map(inputList, o => _.pick(o, [
                          'output_transaction_id',
                          'output_position',
                          'output_transaction_date',
                          'output_shard_id',
                          'address_base',
                          'address_version',
                          'address_key_identifier'
                      ])),
                      transaction_output_list   : _.map(feeOutputList, o => _.pick(o, [
                          'address_base',
                          'address_version',
                          'address_key_identifier',
                          'amount'
                      ])).concat(_.map(outputList, o => _.pick(o, [
                          'address_base',
                          'address_version',
                          'address_key_identifier',
                          'amount'
                      ]))),
                      transaction_signature_list: signatureList
                  };
              }
              else {
                  const refreshOutput      = {
                      ..._.pick(inputList[0], [
                          'address_base',
                          'address_version',
                          'address_key_identifier'
                      ]),
                      amount: _.sum(_.map(feeOutputList, o => o.amount).concat(_.map(outputList, o => o.amount)))
                  };
                  const refreshTransaction = {
                      transaction_input_list    : _.map(inputList, o => _.pick(o, [
                          'output_transaction_id',
                          'output_position',
                          'output_transaction_date',
                          'output_shard_id',
                          'address_base',
                          'address_version',
                          'address_key_identifier'
                      ])),
                      transaction_output_list   : [
                          refreshOutput
                      ],
                      transaction_signature_list: signatureList
                  };

                  let signature;
                  for (let transactionSignature of signatureList) {
                      if (transactionSignature.address_base === refreshOutput.address_base) {
                          signature = _.cloneDeep(transactionSignature);
                          break;
                      }
                  }

                  transaction = {
                      transaction_input_list    : [
                          {
                              'output_transaction_id'  : undefined,
                              'output_position'        : 0,
                              'output_transaction_date': Math.floor(transactionDate.getTime() / 1000),
                              'output_shard_id'        : undefined,
                              'address_base'           : refreshOutput.address_base,
                              'address_version'        : refreshOutput.address_version,
                              'address_key_identifier' : refreshOutput.address_key_identifier
                          }
                      ],
                      transaction_output_list   : _.map(feeOutputList, o => _.pick(o, [
                          'address_base',
                          'address_version',
                          'address_key_identifier',
                          'amount'
                      ])).concat(_.map(outputList, o => _.pick(o, [
                          'address_base',
                          'address_version',
                          'address_key_identifier',
                          'amount'
                      ]))),
                      transaction_signature_list: [signature]
                  };

                  transactionList.push(refreshTransaction);
              }
              transactionList.push(transaction);

              return database.firstShards((shardID) => {
                  const transactionRepository = database.getRepository('transaction', shardID);
                  return new Promise((resolve, reject) => transactionRepository.getFreeTransactions()
                                                                               .then(parents => parents.length ? resolve(parents) : reject()));
              }).then(parents => {
                  if (!parents) {
                      return database.getRepository('transaction').getTopNTransactions(2);
                  }
                  return parents;
              }).then(parents => {
                  if (!parents) {
                      throw Error('parent_transaction_not_available');
                  }

                  transactionList.forEach(transaction => transaction['transaction_parent_list'] = _.map(parents, p => p.transaction_id).sort());
                  return [
                      transactionList,
                      transactionDate
                  ];
              });
          })
          .then(([transactionList, timeNow]) => {
              const hasRefreshTransaction = transactionList.length > 1;
              for (let i = 0; i < transactionList.length; i++) {
                  const transaction = transactionList[i];
                  if (i === 1) { // update transaction to use refresh tx data
                      transaction.transaction_input_list[0].output_transaction_id = transactionList[0].transaction_id;
                      transaction.transaction_input_list[0].output_shard_id       = transactionList[0].shard_id;
                  }
                  transaction.transaction_input_list.forEach((input, idx) => input['input_position'] = idx);
                  transaction.transaction_input_list = _.sortBy(transaction.transaction_input_list, 'input_position');
                  transaction.transaction_output_list.forEach((output, idx) => output['output_position'] = hasRefreshTransaction && i === 0 ? idx : idx - feeOutputList.length);
                  transaction.transaction_output_list    = _.sortBy(transaction.transaction_output_list, 'output_position');
                  transaction.transaction_signature_list = _.sortBy(transaction.transaction_signature_list, 'address_base');

                  let hasSignedOutputAttribute = false;
                  let version                  = hasRefreshTransaction && i === 0 ? config.WALLET_TRANSACTION_REFRESH_VERSION : transactionVersion;
                  const versionType            = version.charAt(1);
                  if ((versionType === 'a' || versionType === 'b') &&
                      parseInt(version.substring(2, version.length - 1)) >= 3) {
                      // transaction output attribute
                      const transactionFeeList                    = feeOutputList.length > 0 ?
                                                                    _.map(feeOutputList, o => _.pick(o, [
                                                                        'node_id_proxy',
                                                                        'fee_type'
                                                                    ])) : undefined;
                      transaction['transaction_output_attribute'] = {
                          transaction_fee            : transactionFeeList,
                          transaction_output_metadata: outputAttributes
                      };

                      if (transaction.transaction_output_attribute.transaction_fee) {
                          transaction.transaction_output_attribute.transaction_fee.forEach((outputAttribute, idx) => outputAttribute['output_position'] = idx - feeOutputList.length);
                      }
                      hasSignedOutputAttribute = true;
                  }

                  transaction['payload_hash']     = objectHash.getCHash288(transaction);
                  transaction['transaction_date'] = Math.floor(timeNow.getTime() / 1000);
                  transaction['node_id_origin']   = network.nodeID;
                  transaction['node_id_proxy']    = nodeIDProxy;
                  transaction['shard_id']         = genesisConfig.genesis_shard_id; // TODO:activate random shard _.sample(_.filter(_.keys(database.shards), shardID => shardID !== SHARD_ZERO_NAME));
                  transaction['version']          = version;
                  const tempAddressSignatures     = {};
                  for (let transactionSignature of transaction.transaction_signature_list) {
                      const privateKeyHex = privateKeyMap[transactionSignature.address_base];
                      if (!privateKeyHex) {
                          return Promise.reject(`private_key_not_found: address<${transactionSignature.address_base}>`);
                      }
                      try {
                          const privateKeyBuf                                      = Buffer.from(privateKeyHex, 'hex');
                          tempAddressSignatures[transactionSignature.address_base] = signature.sign(objectHash.getHashBuffer(transaction), privateKeyBuf);
                      }
                      catch (e) {
                          console.log(`[millix-utils] error: ${e}`);
                          return Promise.reject(`sign_error: address<${transactionSignature.address_base}>`);
                      }
                  }
                  for (let transactionSignature of transaction.transaction_signature_list) {
                      transactionSignature['signature'] = tempAddressSignatures[transactionSignature.address_base];
                  }
                  transaction['transaction_id'] = objectHash.getCHash288(transaction);
                  if (!hasSignedOutputAttribute && (hasRefreshTransaction && i === 1 || !hasRefreshTransaction) && feeOutputList.length > 0) {
                      // transaction output attribute: fee
                      transaction['transaction_output_attribute'] = {
                          transaction_fee            : _.map(feeOutputList, o => _.pick(o, [
                              'node_id_proxy',
                              'fee_type'
                          ])),
                          transaction_output_metadata: outputAttributes
                      };
                      transaction.transaction_output_attribute.transaction_fee.forEach((outputAttribute, idx) => outputAttribute['output_position'] = idx - feeOutputList.length);
                  }
              }
              return transactionList;
          });
    }

    splitOutputAmount(inputList, feeOutputList, numberOfOutputs) {
        const outputList      = [];
        const amount          = _.sum(_.map(inputList, o => o.amount)) - _.sum(_.map(feeOutputList, o => o.amount));
        const amountPerOutput = Math.floor(amount / numberOfOutputs);
        const remainingAmount = amount - numberOfOutputs * amountPerOutput;

        const address = inputList[inputList.length - 1];

        for (let i = 0; i < numberOfOutputs; i++) {
            outputList.push({
                address_base          : address.address_base,
                address_version       : address.address_version,
                address_key_identifier: address.address_key_identifier,
                amount                : amountPerOutput
            });
        }
        // add the remaining amount to the last output
        outputList[outputList.length - 1].amount += remainingAmount;
        return outputList;
    }

    /*
     * generates an aggregation transaction from the active wallet which optimizes the funds and allows spending more funds in fewer transactions
     */
    signAggregationTransaction(inputList = [], feeOutputList, addressAttributeMap, privateKeyMap, transactionDate, transactionVersion, numberOfInputs = 120, numberOfOutputs = 1, numberOfTransactions = 1) {
        if (inputList.length === numberOfOutputs) {
            return Promise.reject({error: 'aggregation_not_required'});
        }

        const totalTransactions = Math.min(Math.ceil(inputList.length / config.TRANSACTION_INPUT_MAX), numberOfTransactions);
        if (totalTransactions === 1) { // we just need to create a single transaction
            feeOutputList[0].amount = config.TRANSACTION_FEE_DEFAULT;
            const outputList        = this.splitOutputAmount(inputList, feeOutputList, numberOfOutputs);
            return this.signTransaction(inputList, outputList, feeOutputList, addressAttributeMap, privateKeyMap, transactionDate, transactionVersion);
        }

        const remainingInputs = inputList.length - totalTransactions * config.TRANSACTION_INPUT_MAX;
        return new Promise((resolve, reject) => {
            const feeOutputListIntermediate = _.cloneDeep(feeOutputList);
            feeOutputListIntermediate.forEach(fee => fee.amount = 0); /* dont pay fee for intermediate transactions */
            async.times(totalTransactions, (idx, callback) => {
                const inputListSlice = _.slice(inputList, idx * config.TRANSACTION_INPUT_MAX, Math.min((idx + 1) * config.TRANSACTION_INPUT_MAX, inputList.length));
                const amount         = _.sum(_.map(inputListSlice, o => o.amount));
                const address        = inputListSlice[inputListSlice.length - 1];
                const outputList     = [
                    {
                        address_base          : address.address_base,
                        address_version       : address.address_version,
                        address_key_identifier: address.address_key_identifier,
                        amount
                    }
                ];

                this.signTransaction(inputListSlice, outputList, feeOutputListIntermediate, addressAttributeMap, privateKeyMap, transactionDate, config.WALLET_TRANSACTION_REFRESH_VERSION)
                    .then(transactions => callback(null, transactions))
                    .catch(error => callback(error));
            }, (error, transactionsList) => {
                if (error) {
                    return reject(error);
                }

                // get only the refresh transaction or the single transaction
                // if there is no refresh
                transactionsList = _.map(transactionsList, intermediateTransactionList => _.first(intermediateTransactionList));

                // get all outputs from intermediate transactions
                const intermediateInputList = _.map(transactionsList, intermediateTransaction => ({
                    'output_transaction_id'  : intermediateTransaction.transaction_id,
                    'output_position'        : 0,
                    'output_transaction_date': intermediateTransaction.transaction_date,
                    'output_shard_id'        : intermediateTransaction.shard_id,
                    ..._.pick(intermediateTransaction.transaction_output_list[0], [
                        'address_base',
                        'address_version',
                        'address_key_identifier',
                        'amount'
                    ])
                }));

                // generate the transaction that aggregates all other
                // intermediate transactions.
                if (_.isEmpty(feeOutputList)) {
                    return reject('transaction_invalid_fee_output');
                }

                feeOutputList[0].amount = transactionsList.length * config.TRANSACTION_FEE_DEFAULT;

                const outputList = this.splitOutputAmount(intermediateInputList, feeOutputList, Math.max(remainingInputs > 0 ? numberOfOutputs - remainingInputs : numberOfOutputs, 1));

                this.signTransaction(intermediateInputList, outputList, feeOutputList, addressAttributeMap, privateKeyMap, transactionDate, transactionVersion)
                    .then(([transaction]) => resolve([
                        ...transactionsList,
                        transaction
                    ]))
                    .catch(reject);
            });
        });
    }
}


export default new WalletUtils();
