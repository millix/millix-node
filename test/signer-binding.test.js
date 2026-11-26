import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import _ from 'lodash';
import base58 from 'bs58';
import secp256k1 from 'secp256k1';
import sqlite3 from 'sqlite3';
import transactionDetails from '../api/IBHgAmydZbmTUAe8/index';
import cache from '../core/cache';
import config from '../core/config/config';
import genesisConfig from '../core/genesis/genesis-config';
import database from '../database/database';
import Address from '../database/repositories/address';
import Keychain from '../database/repositories/keychain';
import Normalization from '../database/repositories/normalization';
import Schema from '../database/repositories/schema';
import Transaction from '../database/repositories/transaction';
import network from '../net/network';
import peer from '../net/peer';
import ntp from '../core/ntp';
import objectHash from '../core/crypto/object-hash';
import signature from '../core/crypto/signature';
import wallet from '../core/wallet/wallet';
import walletSync from '../core/wallet/wallet-sync';
import walletUtils, {UNBOUND_SIGNER_STATUS} from '../core/wallet/wallet-utils';

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

async function openTransactionDatabase(t, schemaFile) {
    const schema = await readFile(path.join(__dirname, '..', 'scripts', schemaFile), 'utf8');
    const connection = new sqlite3.Database(':memory:');
    t.after(() => new Promise((resolve, reject) => connection.close(error => error ? reject(error) : resolve())));
    await new Promise((resolve, reject) => connection.exec(schema, error => error ? reject(error) : resolve()));
    return connection;
}

function runSQL(connection, sql, parameters = []) {
    return new Promise((resolve, reject) => connection.run(sql, parameters, error => error ? reject(error) : resolve()));
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

    test('rejects an unsupported version even when both hashes match', () => {
        const transaction = buildTransaction({version: '0a90'});
        assertWellSigned(transaction);
        assert.equal(walletUtils.isValidTransactionHash(transaction), false);
    });

    for (const [list, limit, makeEntry] of [
        ['transaction_input_list', config.TRANSACTION_INPUT_MAX, position => input(owner, position)],
        ['transaction_output_list', config.TRANSACTION_OUTPUT_MAX, position => ({...walletAddress(recipient), amount: 1000, output_position: position})],
        ['transaction_parent_list', config.TRANSACTION_PARENT_MAX, position => objectHash.getCHash288({position})],
        ['transaction_signature_list', config.TRANSACTION_SIGNATURE_MAX, () => ({
            address_base     : owner.address_base,
            address_attribute: {key_public: owner.key_public}
        })]
    ]) {
        test(`enforces the ${list} limit even when both hashes match`, () => {
            for (const count of [limit, limit + 1]) {
                const transaction = buildTransaction();
                transaction[list] = Array.from({length: count}, (_, position) => makeEntry(position));
                seal(transaction, Array(transaction.transaction_signature_list.length).fill(owner));
                assertWellSigned(transaction);
                assert.equal(walletUtils.isValidTransactionHash(transaction), count === limit);
            }
        });
    }

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

    test('preserves the verified shared key when two writers race to repair a legacy row', async t => {
        const connection = await openTransactionDatabase(t, 'initialize-millix-sqlite3.sql');
        const normalization = new Normalization(connection);
        await normalization.load();
        const addresses = new Address(connection);
        addresses.setNormalizationRepository(normalization);
        const keychain = new Keychain(connection);
        keychain.setNormalizationRepository(normalization);
        const typeID = normalization.get('key_public');
        await runSQL(connection, 'INSERT INTO address_attribute (address_base, address_attribute_type_id, value) VALUES (?, ?, ?)',
            [owner.address_base, typeID, other.key_public]);
        await runSQL(connection, 'CREATE TABLE key_updates (value TEXT)');
        await runSQL(connection, `CREATE TRIGGER count_key_updates AFTER UPDATE OF value ON address_attribute
                                  BEGIN INSERT INTO key_updates VALUES (new.value); END`);

        const originalRun = connection.run.bind(connection);
        const race = t.mock.method(connection, 'run', (sql, parameters, callback) => {
            if (!sql.includes('ON CONFLICT (address_base, address_attribute_type_id)')) {
                return originalRun(sql, parameters, callback);
            }
            return originalRun('UPDATE address_attribute SET value = ? WHERE address_base = ? AND address_attribute_type_id = ?',
                [owner.key_public, owner.address_base, typeID], error => error ? callback(error) : originalRun(sql, parameters, callback));
        });
        await keychain.addAddress('test-wallet', 0, 0, owner.address_base, addressVersion, master.address_base, {key_public: owner.key_public});
        race.mock.restore();
        await addresses.upsertAddressAttribute(owner.address_base, 'key_public', other.key_public);

        assert.equal(await addresses.getAddressBaseAttribute(owner.address_base, 'key_public'), owner.key_public);
        const writes = await new Promise((resolve, reject) => connection.all('SELECT value FROM key_updates', (error, rows) => error ? reject(error) : resolve(rows)));
        assert.deepEqual(writes, [{value: owner.key_public}]);
    });

    test('upgrades main and shard signatures with the legacy shared-key fallback', async t => {
        const mainDB = await openTransactionDatabase(t, 'initialize-millix-sqlite3.sql');
        const shardDB = await openTransactionDatabase(t, 'initialize-millix-shard-sqlite3.sql');
        const addresses = new Address(mainDB);
        const normalization = new Normalization(mainDB);
        addresses.setNormalizationRepository(normalization);
        await normalization.load();
        await addresses.upsertAddressAttribute(owner.address_base, 'key_public', owner.key_public);

        const transaction = buildTransaction();
        const [signer] = transaction.transaction_signature_list;
        for (const [connection, migrationDirectory] of [[mainDB, 'migration'], [shardDB, 'migration/shard']]) {
            const schema = new Schema(connection);
            assert.equal(await schema.getVersion(), '29');
            await runSQL(connection, 'ALTER TABLE transaction_signature DROP COLUMN signer_data');
            await runSQL(connection, 'UPDATE schema_information SET value = ? WHERE key = ?', ['28', 'version']);
            await runSQL(connection, 'INSERT INTO transaction_signature (transaction_id, shard_id, address_base, signature) VALUES (?, ?, ?, ?)',
                [transaction.transaction_id, transaction.shard_id, signer.address_base, signer.signature]);

            await schema.migrate(29, path.join(__dirname, '..', 'scripts', migrationDirectory));
            assert.equal(await schema.getVersion(), '29');
            const repository = new Transaction(connection);
            repository.setAddressRepository(addresses);
            const [legacySigner] = await repository.getTransactionSignatures(transaction.transaction_id);
            assert.equal(legacySigner.signer_data, null);
            assert.equal(legacySigner.signature, signer.signature);
            assert.equal(legacySigner.address_attribute.key_public, owner.key_public);
        }
    });

    for (const repairBeforeConsensus of [true, false]) {
        test(`retains an unbound transaction when a legitimate key arrives ${repairBeforeConsensus ? 'before' : 'after'} consensus`, {timeout: 5000}, async t => {
            const mainDB = await openTransactionDatabase(t, 'initialize-millix-sqlite3.sql');
            const shardDB = await openTransactionDatabase(t, 'initialize-millix-shard-sqlite3.sql');
            shardDB.shardID = 'signer-binding-test-shard';
            const normalization = new Normalization(mainDB);
            const addresses = new Address(mainDB);
            addresses.setNormalizationRepository(normalization);
            await Promise.all([normalization.load(), addresses.loadAddressVersion()]);

            const transactions = new Transaction(mainDB);
            const shardTransactions = new Transaction(shardDB);
            for (const repository of [transactions, shardTransactions]) {
                repository.setAddressRepository(addresses);
                repository.setNormalizationRepository(normalization);
            }

            const shardID = genesisConfig.genesis_shard_id;
            const getRepository = t.mock.method(database, 'getRepository', (name, shard) => {
                return {address: addresses, normalization, transaction: shard === shardDB.shardID ? shardTransactions : transactions}[name];
            });
            const applyShards = t.mock.method(database, 'applyShards', callback => Promise.all([callback(shardID), callback(shardDB.shardID)]).then(results => results.flat()));
            const firstShardZero = t.mock.method(database, 'firstShardZeroORShardRepository', async (name, shard, callback) => callback(transactions).catch(() => undefined));
            t.mock.method(database, 'firstShardORShardZeroRepository', async (name, shard, callback) => callback(transactions));
            t.mock.method(wallet, 'syncShardIfNotExists', async () => {});
            t.mock.method(wallet, '_shouldProcessTransaction', () => true);
            t.mock.method(wallet, 'transactionHasKeyIdentifier', () => false);
            t.mock.method(wallet, '_checkIfWalletUpdate', () => {});
            const notification = t.mock.method(wallet, 'notifyTransactionChanged', () => {});
            t.mock.method(walletSync, 'clearTransactionSync', () => {});
            t.mock.method(walletSync, 'syncTransactionSpendingOutputs', () => {});

            const date = Math.floor(transactionDate);
            const boundStandalone = newKey(5);
            const unboundStandalone = {...recipient, address_base: boundStandalone.address_base};
            const signerKeys = [{...other, address_base: owner.address_base}, unboundStandalone, other];
            const invalid = buildTransaction({
                signerKeys,
                date      : date - (config.TRANSACTION_OUTPUT_EXPIRE_OLDER_THAN + 1) * 60
            });
            const submittedSigner = invalid.transaction_signature_list.find(signer => signer.address_base === owner.address_base);
            submittedSigner.address_attribute.note = 'original signer attribute';
            submittedSigner.note = 'original signer field';
            seal(invalid, _.sortBy(signerKeys, 'address_base'));
            const legitimate = buildTransaction({date});
            const spentInput = invalid.transaction_input_list[0];
            const spendCacheKey = `is_spend_${spentInput.output_transaction_id}_${spentInput.output_position}`;
            t.after(() => {
                cache.removeCacheItem('wallet', spendCacheKey);
                transactions.clearTransactionObjectCache(invalid.transaction_id);
                transactions.clearTransactionObjectCache(legitimate.transaction_id);
                shardTransactions.clearTransactionObjectCache(invalid.transaction_id);
            });

            for (const transactionID of [parentID, spentInput.output_transaction_id]) {
                await transactions.addTransaction(transactionID, shardID, 'fixture', spentInput.output_transaction_date, owner.address_base, owner.address_base, invalid.version);
            }
            await transactions.addTransactionOutput(spentInput.output_transaction_id, shardID, spentInput.output_position,
                owner.address_base + addressVersion + master.address_base, master.address_base, 3000);
            await addresses.upsertAddressAttribute(boundStandalone.address_base, 'key_public', boundStandalone.key_public);

            assertWellSigned(invalid);
            assert.equal(walletUtils.isValidTransactionHash(invalid), true);
            await wallet._onNewTransaction({transaction: invalid}, {node: 'test peer'});
            const cached = await transactions.getTransactionObject(invalid.transaction_id);
            assert.equal(cached.transaction_signature_list.find(signer => signer.address_base === owner.address_base).address_attribute.key_public, null);
            transactions.clearTransactionObjectCache(invalid.transaction_id);
            const pending = await transactions.getTransactionObject(invalid.transaction_id);
            assert.equal(pending.is_stable, 0);
            assert.notEqual(pending.status, 3);
            assert.deepEqual(new Set(pending.transaction_signature_list.filter(signer => signer.status === UNBOUND_SIGNER_STATUS).map(signer => signer.address_base)),
                new Set([owner.address_base, unboundStandalone.address_base]));
            assert.deepEqual(await walletUtils.verifyTransaction(transactions.normalizeTransactionObject(_.cloneDeep(pending))), [false, 'transaction_object_invalid']);

            assert.equal(await addresses.getAddressBaseAttribute(owner.address_base, 'key_public'), null);
            assert.equal(await addresses.getAddressBaseAttribute(unboundStandalone.address_base, 'key_public'), boundStandalone.key_public);
            assert.equal(await addresses.getAddressBaseAttribute(other.address_base, 'key_public'), other.key_public);
            assert.equal(cache.getCacheItem('wallet', spendCacheKey), null);
            assert.equal((await transactions.getTransactionOutputs(spentInput.output_transaction_id))[0].is_spent, 0);
            assert.equal((await transactions.getTransaction(parentID)).is_parent, 0);
            assert.equal(await transactions.getTransactionParentDate(parentID), null);
            assert.equal(await transactions.getOutputSpendDate(spentInput.output_transaction_id, spentInput.output_position), null);
            assert.deepEqual(await transactions.getInputDoubleSpend(spentInput, legitimate.transaction_id), []);
            assert.deepEqual(await transactions.getSpendTransactions(spentInput.output_transaction_id), []);

            const socket = {node: 'test peer'};
            t.mock.method(network, 'getWebSocketByID', () => socket);
            let sendSyncResponse;
            t.mock.method(peer, 'transactionSyncResponse', response => sendSyncResponse(response));
            const requestSync = () => new Promise(resolve => {
                sendSyncResponse = resolve;
                wallet._onSyncTransaction({transaction_id: invalid.transaction_id}, socket);
            });
            const pendingReply = await requestSync();
            assert.equal(pendingReply.transaction_not_found, undefined);
            assert.equal(walletUtils.isValidTransactionHash(pendingReply.transaction), true);
            assert.deepEqual(pendingReply.transaction, invalid);

            await shardTransactions.addTransactionFromShardObject(pending, false);
            shardTransactions.clearTransactionObjectCache(invalid.transaction_id);
            const moved = await shardTransactions.getTransactionObject(invalid.transaction_id);
            assert.equal(walletUtils.hasUnboundTransactionSigner(moved), true);
            assert.equal(transactions.isSameTransactionObject(_.cloneDeep(pending), moved), true);
            const copyWithoutMarker = _.cloneDeep(moved);
            copyWithoutMarker.transaction_signature_list.find(signer => signer.address_base === owner.address_base).status = 1;
            assert.equal(transactions.isSameTransactionObject(_.cloneDeep(pending), copyWithoutMarker), false);
            await runSQL(mainDB, 'UPDATE `transaction` SET create_date = ? WHERE transaction_id = ?', [date - 60, invalid.transaction_id]);
            assert.deepEqual((await transactions.findUnstableTransaction([], false)).map(row => row.transaction_id), [invalid.transaction_id]);

            const acceptLegitimate = async () => {
                const status = repairBeforeConsensus ? 3 : 1;
                await runSQL(mainDB, 'INSERT INTO address_attribute (address_base, address_attribute_type_id, value, status) VALUES (?, ?, ?, ?)',
                    [owner.address_base, normalization.get('key_public'), other.key_public, status]);
                assert.equal(await addresses.getAddressBaseAttribute(owner.address_base, 'key_public'), status === 3 ? null : other.key_public);
                await wallet._onNewTransaction({transaction: legitimate}, {node: 'test peer'});
                const [key] = await addresses.listAddressAttribute({address_base: owner.address_base});
                assert.equal(key.value, owner.key_public);
                assert.equal(key.status, 1);
                const storedValid = await transactions.getTransactionObjectFromDB(legitimate.transaction_id);
                assert.deepEqual(await walletUtils.verifyTransaction(transactions.normalizeTransactionObject(storedValid)), [true, undefined]);

                transactions.clearTransactionObjectCache(invalid.transaction_id);
                const storedInvalid = await transactions.getTransactionObject(invalid.transaction_id);
                assert.equal(storedInvalid.transaction_signature_list.find(signer => signer.address_base === owner.address_base).address_attribute.key_public, null);
                assert.deepEqual(await walletUtils.verifyTransaction(transactions.normalizeTransactionObject(storedInvalid)), [false, 'transaction_object_invalid']);
            };
            if (repairBeforeConsensus) {
                await acceptLegitimate();
                await runSQL(mainDB, 'UPDATE transaction_signature SET signer_data = NULL WHERE transaction_id = ?', [legitimate.transaction_id]);
                const legacyTransaction = await transactions.getTransactionObjectFromDB(legitimate.transaction_id);
                assert.equal(walletUtils.isValidTransactionHash(transactions.normalizeTransactionObject(legacyTransaction)), true);
            }
            await assert.rejects(wallet.getConsensus()._startConsensusRound(invalid.transaction_id));
            for (const repository of [transactions, shardTransactions]) {
                const stored = await repository.getTransactionObject(invalid.transaction_id);
                assert.equal(stored.status, 3);
                assert.ok(stored.transaction_input_list.every(input => input.status === 3));
                assert.ok(stored.transaction_output_list.every(output => output.status === 3));
            }
            assert.equal(notification.mock.calls.at(-1).arguments[1], 'transaction_validation:invalid');

            if (!repairBeforeConsensus) {
                await acceptLegitimate();
            }
            const getDetails = transactionID => new Promise(resolve => transactionDetails.handler(null, {query: {p0: transactionID, p1: shardID}}, {send: resolve}));
            const invalidDetails = await getDetails(invalid.transaction_id);
            assert.equal(invalidDetails.status, 3);
            assert.equal(invalidDetails.transaction_signature_list.find(signer => signer.address_base === owner.address_base).key_public, null);
            const legitimateDetails = await getDetails(legitimate.transaction_id);
            assert.equal(legitimateDetails.transaction_signature_list[0].key_public, owner.key_public);

            transactions.clearTransactionObjectCache(invalid.transaction_id);
            const invalidReply = await requestSync();
            assert.equal(invalidReply.transaction_not_found, undefined);
            assert.equal(walletUtils.isValidTransactionHash(invalidReply.transaction), true);
            assert.deepEqual(invalidReply.transaction, invalid);

            if (repairBeforeConsensus) {
                // A marked legacy row has no original key to send, but remains available to local consensus.
                await runSQL(mainDB, 'UPDATE transaction_signature SET signer_data = NULL WHERE transaction_id = ? AND address_base = ?',
                    [invalid.transaction_id, owner.address_base]);
                transactions.clearTransactionObjectCache(invalid.transaction_id);
                const unavailable = await requestSync();
                assert.equal(unavailable.transaction_not_found, true);
                assert.deepEqual(unavailable.transaction, {transaction_id: invalid.transaction_id});
                assert.equal((await transactions.getTransaction(invalid.transaction_id)).status, 3);

                const receivingDB = await openTransactionDatabase(t, 'initialize-millix-sqlite3.sql');
                receivingDB.shardID = 'signer-binding-receiving-node';
                const receiver = new Transaction(receivingDB);
                const receiverAddresses = new Address(receivingDB);
                const receiverNormalization = new Normalization(receivingDB);
                receiverAddresses.setNormalizationRepository(receiverNormalization);
                receiver.setAddressRepository(receiverAddresses);
                receiver.setNormalizationRepository(receiverNormalization);
                await Promise.all([receiverNormalization.load(), receiverAddresses.loadAddressVersion()]);
                await receiverAddresses.upsertAddressAttribute(owner.address_base, 'key_public', owner.key_public);
                t.after(() => receiver.clearTransactionObjectCache(invalid.transaction_id));

                getRepository.mock.mockImplementation(name => ({address: receiverAddresses, normalization: receiverNormalization, transaction: receiver})[name]);
                applyShards.mock.mockImplementation(async callback => [await callback(shardID)]);
                firstShardZero.mock.mockImplementation(async (name, shard, callback) => callback(receiver).catch(() => undefined));
                const ingest = wallet._onNewTransaction.bind(wallet);
                await new Promise((resolve, reject) => {
                    t.mock.method(wallet, '_onNewTransaction', (...args) => Promise.resolve().then(() => ingest(...args)).then(resolve, reject));
                    wallet._onTransactionSyncResponse(invalidReply, socket);
                });
                assert.notEqual((await receiver.getTransaction(invalid.transaction_id)).status, 3);
                await assert.rejects(wallet.getConsensus()._startConsensusRound(invalid.transaction_id));
                assert.equal((await receiver.getTransaction(invalid.transaction_id)).status, 3);
                assert.equal(await receiverAddresses.getAddressBaseAttribute(owner.address_base, 'key_public'), owner.key_public);
            }
        });
    }

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
