// shared fixtures for the tests: keys, addresses, an in-memory stand-in for
// the database repositories and a transaction builder that signs like
// walletUtils.signTransaction. nothing here opens a database or a socket.
import _ from 'lodash';
import crypto from 'crypto';
import base58 from 'bs58';
import config from '../core/config/config';
import database from '../database/database';
import Address from '../database/repositories/address';
import walletUtils from '../core/wallet/wallet-utils';
import objectHash from '../core/crypto/object-hash';
import signature from '../core/crypto/signature';

// the address and transaction versions of the network the node is
// configured for (main network unless core/config/environment.js says
// otherwise)
export const VERSION = config.MODE_TEST_NETWORK ? {
    address_wallet     : 'lal',
    transaction        : 'la2l',
    transaction_signed : 'la3l',
    transaction_refresh: 'lb3l'
} : {
    address_wallet     : '0a0',
    transaction        : '0a20',
    transaction_signed : '0a30',
    transaction_refresh: '0b30'
};

export const SHARD_ID = 'AyAC3kjLtjM4vktAJ5Xq6mbXKjzEqXoSsmGhhgjnkXUvjtF2M';

export function now() {
    return Math.floor(Date.now() / 1000);
}

/**
 * a key pair the way the node uses them: private_key is a 32 byte buffer,
 * public_key the base58 compressed public key, address_base its address.
 * node_private_key is the bitcore key the node signs offers with.
 */
export function newKey() {
    const hdKey     = walletUtils.generateNodeKey();
    const publicKey = base58.encode(hdKey.publicKey.toBuffer());
    return {
        private_key     : hdKey.privateKey.toBuffer({size: 32}),
        node_private_key: hdKey.privateKey,
        public_key      : publicKey,
        address_base    : walletUtils.getAddressFromPublicKey(base58.decode(publicKey))
    };
}

export function walletAddress(key) {
    return {
        address_base          : key.address_base,
        address_version       : VERSION.address_wallet,
        address_key_identifier: key.address_base
    };
}

export function fullAddress(key) {
    return `${key.address_base}${VERSION.address_wallet}${key.address_base}`;
}

/**
 * replaces database.getRepository with in-memory repositories. the address
 * repository is the real one with the address versions of both networks
 * loaded, as loadAddressVersion would from the database.
 * @param repositoryMap other repositories by name
 * @return {function} restores database.getRepository
 */
export function stubRepositories(repositoryMap = {}) {
    const addressRepository = new Address(null);
    [
        '0a0',
        'lal',
        config.ADDRESS_VERSION_ESCROW
    ].forEach(version => {
        addressRepository.addressVersionList.push({
            version,
            is_default   : version === VERSION.address_wallet ? 1 : 0,
            regex_pattern: `(?<address>.*)(?<version>${version})(?<identifier>.*)`
        });
        addressRepository.supportedVersionSet.add(version);
    });
    addressRepository.getDefaultAddressVersion = () => ({version: VERSION.address_wallet});

    const getRepository    = database.getRepository;
    database.getRepository = name => name === 'address' ? addressRepository : repositoryMap[name];
    return () => database.getRepository = getRepository;
}

/**
 * an unspent output of an escrow address, as wallet-escrow lists them
 */
export function escrowInput(escrowAddress, amount, outputTransactionDate = now() - 60, outputPosition = 0) {
    return {
        output_transaction_id  : 'A'.repeat(50),
        output_position        : outputPosition,
        output_transaction_date: outputTransactionDate,
        output_shard_id        : SHARD_ID,
        input_position         : outputPosition,
        address_base           : escrowAddress.address_base,
        address_version        : escrowAddress.address_version,
        address_key_identifier : escrowAddress.address_key_identifier,
        amount
    };
}

/**
 * builds and signs a transaction the way walletUtils.signTransaction does:
 * the payload hash, then every signer signs the transaction hash, then the
 * transaction id. the fee output is added at position -1.
 * @param inputList
 * @param outputList outputs without positions
 * @param signerList [{address_base, public_key, private_key}]
 * @param metadata transaction_output_metadata
 * @param version
 * @param transactionDate
 */
export function buildTransaction({
                                     inputList,
                                     outputList,
                                     signerList,
                                     metadata = {note: 'no escrow entry'},
                                     version = VERSION.transaction_signed,
                                     transactionDate = now()
                                 }) {
    const proxy       = signerList[0].address_base;
    const transaction = {
        transaction_input_list      : inputList.map((input, position) => ({
            ...input,
            input_position: position
        })),
        transaction_output_list     : [
            {
                address_base          : proxy,
                address_version       : VERSION.address_wallet,
                address_key_identifier: proxy,
                amount                : config.TRANSACTION_FEE_PROXY,
                output_position       : -1
            }
        ].concat(outputList.map((output, position) => ({
            ...output,
            output_position: position
        }))),
        transaction_signature_list  : signerList.map(signer => ({
            address_base     : signer.address_base,
            address_attribute: {key_public: signer.public_key}
        })).sort((a, b) => a.address_base < b.address_base ? -1 : 1),
        transaction_parent_list     : ['B'.repeat(49)],
        transaction_output_attribute: {
            transaction_fee            : [
                {
                    node_id_proxy: proxy,
                    fee_type     : 'transaction_fee_default',
                    output_position: -1
                }
            ],
            transaction_output_metadata: metadata
        }
    };
    transaction.transaction_input_list.forEach(input => delete input.amount);
    // the output attributes are signed from transaction version 3 only
    const versionNumber = parseInt(version.substring(2, version.length - 1));
    const signedPart    = () => versionNumber >= 3 ? transaction : _.omit(transaction, ['transaction_output_attribute']);
    transaction.payload_hash     = objectHash.getCHash288(signedPart());
    transaction.transaction_date = transactionDate;
    transaction.node_id_origin   = proxy;
    transaction.node_id_proxy    = proxy;
    transaction.shard_id         = SHARD_ID;
    transaction.version          = version;
    const hash                   = objectHash.getHashBuffer(signedPart());
    transaction.transaction_signature_list.forEach(transactionSignature => {
        const signer                   = signerList.find(s => s.public_key === transactionSignature.address_attribute.key_public);
        transactionSignature.signature = signature.sign(hash, signer.private_key);
    });
    transaction.transaction_id = objectHash.getCHash288(signedPart());
    return transaction;
}

/**
 * runs the node's own transaction check on a copy of the transaction
 */
export function isValidTransaction(transaction) {
    return walletUtils.isValidTransactionObject(JSON.parse(JSON.stringify(transaction)));
}

export function newNonce() {
    return crypto.randomBytes(16).toString('hex');
}
