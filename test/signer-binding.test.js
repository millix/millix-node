import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import _ from 'lodash';
import base58 from 'bs58';
import secp256k1 from 'secp256k1';
import config from '../core/config/config';
import genesisConfig from '../core/genesis/genesis-config';
import database from '../database/database';
import network from '../net/network';
import ntp from '../core/ntp';
import objectHash from '../core/crypto/object-hash';
import signature from '../core/crypto/signature';
import walletUtils from '../core/wallet/wallet-utils';

const transactionDate = ntp.now().getTime() / 1000;
const addressVersion  = config.MODE_TEST_NETWORK ? 'lal' : '0a0';
const parentID        = 'B'.repeat(49);
const legacyVersions  = new Set(['0a0', '0b0', 'la0l', 'lb0l']);

function newKey(value) {
    const privateKey = Buffer.alloc(32);
    privateKey[31]   = value;
    const publicKey  = secp256k1.publicKeyCreate(privateKey);
    return {
        private_key: privateKey,
        key_public : base58.encode(publicKey),
        address_base: walletUtils.getAddressFromPublicKey(publicKey)
    };
}

const owner     = newKey(1);
const other     = newKey(2);
const recipient = newKey(3);
const master    = newKey(4);

function walletAddress(key) {
    return {
        address_base          : key.address_base,
        address_version       : addressVersion,
        address_key_identifier: master.address_base
    };
}

function input(key, position = 0, date = transactionDate) {
    return {
        ...walletAddress(key),
        input_position         : position,
        output_transaction_id  : 'A'.repeat(49),
        output_position        : position,
        output_transaction_date: date - 60,
        output_shard_id        : genesisConfig.genesis_shard_id
    };
}

function hasSignedAttributes(transaction) {
    return parseInt(transaction.version.substring(2, transaction.version.length - 1)) >= 3;
}

function signedFields(transaction) {
    return _.omit(transaction, [
        'transaction_id',
        ...hasSignedAttributes(transaction) ? [] : ['transaction_output_attribute']
    ]);
}

function signaturePayload(transaction, genesis = false) {
    const payload = _.cloneDeep(_.omit(signedFields(transaction), [
        'payload_hash', 'transaction_date', 'node_id_origin', 'node_id_proxy', 'shard_id', 'version'
    ]));
    payload.transaction_signature_list.forEach(entry => delete entry.signature);
    if (genesis) {
        delete payload.transaction_parent_list;
    }
    return payload;
}

function signingObject(transaction, genesis = false) {
    return {
        ...signaturePayload(transaction, genesis),
        payload_hash    : transaction.payload_hash,
        transaction_date: transaction.transaction_date,
        node_id_origin  : transaction.node_id_origin,
        node_id_proxy   : transaction.node_id_proxy,
        shard_id        : transaction.shard_id,
        version         : transaction.version
    };
}

function seal(transaction, signerKeys, genesis = false) {
    transaction.payload_hash = objectHash.getCHash288(signaturePayload(transaction, genesis));
    const signingView        = signingObject(transaction, genesis);
    const hash               = objectHash.getHashBuffer(signingView);
    signingView.transaction_signature_list.forEach((entry, index) => {
        entry.signature = signature.sign(hash, signerKeys[index].private_key);
    });
    transaction.transaction_signature_list = signingView.transaction_signature_list;
    transaction.transaction_id             = objectHash.getCHash288(signingView);
    return transaction;
}

function buildTransaction({
                              inputKeys = [owner],
                              signerKeys = inputKeys,
                              version = config.WALLET_TRANSACTION_DEFAULT_VERSION,
                              date = transactionDate,
                              genesis = false
                          } = {}) {
    const sortedSigners = _.sortBy(signerKeys, 'address_base');
    const transaction   = {
        transaction_input_list    : inputKeys.map((key, index) => input(key, index, date)),
        transaction_output_list   : [
            {...walletAddress(owner), amount: 1000, output_position: -1},
            {...walletAddress(recipient), amount: 2000, output_position: 0}
        ],
        transaction_parent_list   : [parentID],
        transaction_signature_list: sortedSigners.map(key => ({
            address_base     : key.address_base,
            address_attribute: {key_public: key.key_public}
        })),
        transaction_output_attribute: {
            transaction_fee: [{node_id_proxy: owner.address_base, fee_type: 'transaction_fee_default', output_position: -1}],
            transaction_output_metadata: {note: 'offline validator fixture'}
        },
        transaction_date: legacyVersions.has(version) ? new Date(date * 1000).toISOString() : date,
        node_id_origin  : owner.address_base,
        node_id_proxy   : owner.address_base,
        shard_id        : genesisConfig.genesis_shard_id,
        version
    };

    if (version === config.BRIDGE_TRANSACTION_VERSION_MINT || version === config.BRIDGE_TRANSACTION_VERSION_BURN) {
        transaction.transaction_output_attribute.transaction_output_metadata = {
            bridge_mapping: {address: 'offline-bridge-destination', network: 'offline-network'}
        };
        transaction.transaction_output_list[1].amount = 1000;
        transaction.transaction_output_list.push({
            ...walletAddress(other), amount: 1000, output_position: 1
        });
        const bridgePosition = version === config.BRIDGE_TRANSACTION_VERSION_MINT ? 1 : 2;
        transaction.transaction_output_list[bridgePosition].address_version = config.ADDRESS_VERSION_BRIDGE;
    }

    if (genesis) {
        transaction.transaction_input_list = [{type: 'issue', amount: config.MILLIX_CIRCULATION, input_position: 0}];
        transaction.transaction_parent_list = [];
    }
    return seal(transaction, sortedSigners, genesis);
}

function isValid(transaction) {
    return walletUtils.isValidTransactionObject(_.cloneDeep(transaction));
}

// Regression fixtures must have consistent hashes and valid ECDSA signatures,
// including when the claimed signer address or input coverage is incorrect.
function assertWellSigned(transaction) {
    assert.equal(transaction.payload_hash, objectHash.getCHash288(signaturePayload(transaction)));
    assert.equal(transaction.transaction_id, objectHash.getCHash288(signedFields(transaction)));
    const hash = objectHash.getHashBuffer(signingObject(transaction));
    for (const entry of transaction.transaction_signature_list) {
        assert.equal(signature.verify(hash, entry.signature, entry.address_attribute.key_public), true);
    }
}

const originalGetRepository = database.getRepository;
const originalFirstShards   = database.firstShards;
const originalNodeID        = network.nodeID;
before(() => {
    database.getRepository = name => {
        if (name === 'address') {
            return {supportedVersionSet: new Set([addressVersion, config.ADDRESS_VERSION_BRIDGE, config.ADDRESS_VERSION_NFT])};
        }
        if (name === 'transaction') {
            return {getFreeTransactions: async () => [{transaction_id: parentID}]};
        }
        throw Error(`unexpected repository: ${name}`);
    };
    database.firstShards = callback => Promise.resolve(callback(genesisConfig.genesis_shard_id));
    network.nodeID       = owner.address_base;
});
after(() => {
    database.getRepository = originalGetRepository;
    database.firstShards   = originalFirstShards;
    network.nodeID         = originalNodeID;
});

describe(`signer binding (${config.MODE_TEST_NETWORK ? 'test network' : 'main network'})`, () => {
    for (const version of config.WALLET_TRANSACTION_SUPPORTED_VERSION) {
        test(`${version}: accepts a valid signer`, async () => {
            const transaction = buildTransaction({version});
            assertWellSigned(transaction);
            assert.equal(walletUtils.isValidTransactionHash(transaction), true);
            assert.equal(isValid(transaction), true);
            assert.deepEqual(await walletUtils.verifyTransaction(_.cloneDeep(transaction)), [true, undefined]);
            if (version === config.BRIDGE_TRANSACTION_VERSION_MINT || version === config.BRIDGE_TRANSACTION_VERSION_BURN) {
                assert.equal(walletUtils.isValidBridgeTransaction(transaction, version === config.BRIDGE_TRANSACTION_VERSION_MINT), true);
            }
        });

        test(`${version}: rejects a signature under another address's label`, async () => {
            const transaction = buildTransaction({version, signerKeys: [{...other, address_base: owner.address_base}]});
            assertWellSigned(transaction);
            assert.equal(isValid(transaction), false);
            assert.deepEqual(await walletUtils.verifyTransaction(transaction), [false, 'transaction_object_invalid']);
        });

        test(`${version}: rejects inputs without their owner's signature`, async () => {
            const transaction = buildTransaction({version, inputKeys: [owner, other], signerKeys: [owner]});
            assertWellSigned(transaction);
            assert.equal(isValid(transaction), false);
            assert.deepEqual(await walletUtils.verifyTransaction(transaction), [false, 'transaction_object_invalid']);
        });
    }

    test('accepts signatures from every distinct input address', () => {
        const transaction = buildTransaction({inputKeys: [owner, other]});
        assertWellSigned(transaction);
        assert.equal(isValid(transaction), true);
    });

    test('checks the payload hash and transaction ID independently', () => {
        const transaction = buildTransaction();
        const wrongID     = {...transaction, transaction_id: 'wrong ID'};
        const wrongHash   = {...transaction, payload_hash: 'wrong hash'};
        wrongHash.transaction_id = objectHash.getCHash288(signedFields(wrongHash));

        assert.equal(walletUtils.isValidTransactionHash(wrongID), false);
        assert.equal(walletUtils.isValidTransactionHash(wrongHash), false);
        assert.equal(isValid(wrongID), false);
        assert.equal(isValid(wrongHash), false);
    });

    test('checks hashes with reordered lists without mutating the transaction', () => {
        const transaction = buildTransaction({inputKeys: [owner, other]});
        transaction.transaction_input_list.reverse();
        transaction.transaction_output_list.reverse();
        transaction.transaction_signature_list.reverse();
        const original = _.cloneDeep(transaction);

        assert.equal(walletUtils.isValidTransactionHash(transaction), true);
        assert.deepEqual(transaction, original);
    });

    test('rejects missing or unhashable transaction data', () => {
        assert.equal(walletUtils.isValidTransactionHash(null), false);
        const transaction = buildTransaction();
        transaction.transaction_output_list[0].amount = null;
        assert.equal(walletUtils.isValidTransactionHash(transaction), false);
    });

    test('accepts repeated input addresses with one signature', () => {
        const transaction = buildTransaction({inputKeys: [owner, owner], signerKeys: [owner]});
        assertWellSigned(transaction);
        assert.equal(isValid(transaction), true);
    });

    test('accepts additional correctly bound signers', () => {
        const transaction = buildTransaction({signerKeys: [owner, other]});
        assertWellSigned(transaction);
        assert.equal(isValid(transaction), true);
    });

    test('requires the input address signer even if another address is correctly signed', () => {
        const transaction = buildTransaction({signerKeys: [other]});
        assertWellSigned(transaction);
        assert.equal(isValid(transaction), false);
    });

    test('rejects an empty signature list before hashing', async () => {
        const transaction = buildTransaction();
        transaction.transaction_signature_list = [];
        assert.equal(isValid(transaction), false);
        assert.deepEqual(await walletUtils.verifyTransaction(transaction), [false, 'transaction_object_invalid']);
    });

    for (const value of [undefined, null, {}, 'invalid']) {
        test(`rejects a non-array signature list: ${JSON.stringify(value)}`, () => {
            const transaction = buildTransaction();
            transaction.transaction_signature_list = value;
            assert.equal(isValid(transaction), false);
        });
    }

    const malformedEntries = [
        ['missing entry', () => undefined],
        ['null entry', () => null],
        ['string entry', () => 'invalid'],
        ['empty entry', () => ({})],
        ['missing address', entry => _.omit(entry, 'address_base')],
        ['non-string address', entry => ({...entry, address_base: 1})],
        ['invalid Base58 address', entry => ({...entry, address_base: '10'})],
        ['invalid address checksum', entry => ({...entry, address_base: owner.address_base + '1'})],
        ['missing attributes', entry => _.omit(entry, 'address_attribute')],
        ['null attributes', entry => ({...entry, address_attribute: null})],
        ['empty attributes', entry => ({...entry, address_attribute: {}})],
        ['array attributes', entry => ({...entry, address_attribute: []})],
        ['non-string public key', entry => ({...entry, address_attribute: {key_public: 1}})],
        ['null public key', entry => ({...entry, address_attribute: {key_public: null}})],
        ['invalid Base58 public key', entry => ({...entry, address_attribute: {key_public: '0'}})],
        ['empty public key', entry => ({...entry, address_attribute: {key_public: ''}})],
        ['missing signature', entry => _.omit(entry, 'signature')],
        ['null signature', entry => ({...entry, signature: null})],
        ['non-string signature', entry => ({...entry, signature: 1})],
        ['invalid Base58 signature', entry => ({...entry, signature: '0'})],
        ['empty signature', entry => ({...entry, signature: ''})],
        ['wrong signature length', entry => ({...entry, signature: '1'})]
    ];
    for (const [name, change] of malformedEntries) {
        test(`rejects ${name} without throwing`, async t => {
            t.mock.method(console, 'log', () => {});
            const transaction = buildTransaction();
            transaction.transaction_signature_list[0] = change(transaction.transaction_signature_list[0]);
            assert.equal(isValid(transaction), false);
            assert.deepEqual(await walletUtils.verifyTransaction(transaction), [false, 'transaction_object_invalid']);
        });
    }

    test('rejects invalid public-key bytes even when their derived address matches', t => {
        t.mock.method(console, 'log', () => {});
        const invalidPublicKey = Buffer.alloc(33);
        const invalidSigner    = {
            ...owner,
            key_public  : base58.encode(invalidPublicKey),
            address_base: walletUtils.getAddressFromPublicKey(invalidPublicKey)
        };
        const transaction = buildTransaction({inputKeys: [invalidSigner]});
        assert.equal(transaction.payload_hash, objectHash.getCHash288(signaturePayload(transaction)));
        assert.equal(transaction.transaction_id, objectHash.getCHash288(signedFields(transaction)));
        assert.equal(isValid(transaction), false);
    });

    test('still rejects a cryptographically invalid signature with correct address binding', () => {
        const transaction = seal(buildTransaction(), [other]);
        assert.equal(transaction.payload_hash, objectHash.getCHash288(signaturePayload(transaction)));
        assert.equal(transaction.transaction_id, objectHash.getCHash288(signedFields(transaction)));
        assert.equal(walletUtils.isValidTransactionHash(transaction), true);
        assert.equal(isValid(transaction), false);
    });

    test('rejects unsigned input addresses before the historical expiry exemption', async () => {
        const transaction = buildTransaction({inputKeys: [owner, other], signerKeys: [owner], date: 1590000000});
        assertWellSigned(transaction);
        assert.deepEqual(await walletUtils.verifyTransaction(transaction), [false, 'transaction_object_invalid']);
    });

    test('preserves the configured genesis verification shortcut', async () => {
        assert.deepEqual(await walletUtils.verifyTransaction({transaction_id: genesisConfig.genesis_transaction}), [true]);
    });

    test('preserves genesis issuance inputs without an address to cover', () => {
        const transaction = buildTransaction({version: config.WALLET_TRANSACTION_SUPPORTED_VERSION[0], genesis: true});
        const genesisID   = genesisConfig.genesis_transaction;
        try {
            genesisConfig.genesis_transaction = transaction.transaction_id;
            assert.equal(walletUtils.isValidTransactionHash(transaction), true);
            assert.equal(isValid(transaction), true);
        }
        finally {
            genesisConfig.genesis_transaction = genesisID;
        }
    });

    for (const expired of [false, true]) {
        test(`accepts wallet-generated ${expired ? 'refresh and spend' : 'spend'} transactions`, async () => {
            const inputList = [owner, other].map((key, index) => ({
                ...input(key, index, transactionDate - (expired ? (config.TRANSACTION_OUTPUT_EXPIRE_OLDER_THAN + 1) * 60 : 0)),
                amount: 1500
            }));
            const attributes = Object.fromEntries([owner, other].map(key => [key.address_base, {key_public: key.key_public}]));
            const privateKeys = Object.fromEntries([owner, other].map(key => [key.address_base, key.private_key.toString('hex')]));
            const transactions = await walletUtils.signTransaction(
                inputList,
                [{...walletAddress(recipient), amount: 2000}],
                [{...walletAddress(owner), amount: 1000, node_id_proxy: owner.address_base}],
                attributes,
                privateKeys,
                new Date(transactionDate * 1000),
                config.WALLET_TRANSACTION_DEFAULT_VERSION
            );
            assert.equal(transactions.length, expired ? 2 : 1);
            for (const transaction of transactions) {
                assertWellSigned(transaction);
                assert.equal(isValid(transaction), true);
                assert.deepEqual(await walletUtils.verifyTransaction(_.cloneDeep(transaction)), [true, undefined]);
            }
        });
    }
});
