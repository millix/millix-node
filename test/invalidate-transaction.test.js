import {test} from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import console from '../core/console';
import {WalletTransactionConsensus} from '../core/wallet/wallet-transaction-consensus';
import wallet from '../core/wallet/wallet';
import database from '../database/database';
import Transaction from '../database/repositories/transaction';

const TRANSACTION_ID = 'dry5ncfKaBVDH6JjbtunS1hFM2MfHm6XdBBoM7b3NUdrrdmKF';

test('finds invalid funding transactions and exact invalid outputs in SQLite', async t => {
    const connection = new sqlite3.Database(':memory:');
    t.after(() => new Promise((resolve, reject) => connection.close(error => error ? reject(error) : resolve())));
    await new Promise((resolve, reject) => connection.exec(`
        CREATE TABLE "transaction" (transaction_id TEXT PRIMARY KEY, status INTEGER);
        CREATE TABLE transaction_output (transaction_id TEXT, output_position INTEGER, status INTEGER,
                                         PRIMARY KEY (transaction_id, output_position));
        INSERT INTO "transaction" VALUES ('funding-invalid', 3), ('output-invalid', 1);
        INSERT INTO transaction_output VALUES ('output-invalid', 0, 1), ('output-invalid', 1, 3);
    `, error => error ? reject(error) : resolve()));
    const repository = new Transaction(connection);
    const missing = {output_transaction_id: 'missing', output_position: 0};
    const healthy = {output_transaction_id: 'output-invalid', output_position: 0};
    const invalidOutput = {output_transaction_id: 'output-invalid', output_position: 1};
    const invalidFunding = {output_transaction_id: 'funding-invalid', output_position: 0};

    assert.equal(await repository.findInvalidInputSource([]), undefined);
    assert.equal(await repository.findInvalidInputSource([missing, healthy]), undefined);
    assert.deepEqual(await repository.findInvalidInputSource([missing, healthy, invalidOutput]), invalidOutput);
    assert.deepEqual(await repository.findInvalidInputSource([invalidFunding]), invalidFunding);
    assert.deepEqual(await repository.findInvalidInputSource([healthy], true), healthy);
});

function setup(t, storedTransaction) {
    const consensus  = new WalletTransactionConsensus();
    consensus.clearState();
    const calls      = [];
    const repository = {
        getTransactionObject       : async() => storedTransaction,
        invalidateTransaction      : async transactionID => calls.push(['invalidate', transactionID]),
        clearTransactionObjectCache: transactionID => calls.push(['clear_cache', transactionID])
    };
    t.mock.method(console, 'log', () => {});
    t.mock.method(database, 'getRepository', () => repository);
    t.mock.method(database, 'firstShards', async callback => callback('shard_zero'));
    t.mock.method(database, 'applyShards', async callback => callback('shard_zero'));
    t.mock.method(consensus, 'resetInputsSpentByTransaction', async transaction => calls.push(['reset_inputs', transaction.transaction_id]));
    t.mock.method(consensus, 'resetValidTransactionSpendingFromInvalidTransaction', async transaction => calls.push(['reset_spending', transaction.transaction_id]));
    const walletUpdate = t.mock.method(wallet, '_checkIfWalletUpdate', () => {});
    const notify       = t.mock.method(wallet, 'notifyTransactionChanged', () => {});
    return {consensus, calls, walletUpdate, notify};
}

test('invalidates the transaction, frees its inputs and resets the transactions spending it', {timeout: 5000}, async t => {
    const stored                                 = {
        transaction_id         : TRANSACTION_ID,
        transaction_input_list : [],
        transaction_output_list: [{address_key_identifier: 'key'}]
    };
    const {consensus, calls, walletUpdate, notify} = setup(t, stored);
    let roundResolved                            = false;
    consensus._consensusRoundState[TRANSACTION_ID] = {
        active : true,
        resolve: () => roundResolved = true
    };

    const result = await consensus.invalidateTransaction(TRANSACTION_ID);

    assert.equal(result, stored);
    assert.deepEqual(calls, [
        ['invalidate', TRANSACTION_ID],
        ['clear_cache', TRANSACTION_ID],
        ['reset_inputs', TRANSACTION_ID],
        ['reset_spending', TRANSACTION_ID]
    ]);
    assert.equal(consensus._consensusRoundState[TRANSACTION_ID].active, false);
    assert.equal(roundResolved, true);
    assert.ok(consensus.getRejectedTransactionList().has(TRANSACTION_ID));
    assert.deepEqual([...walletUpdate.mock.calls[0].arguments[0]], ['key']);
    assert.deepEqual(notify.mock.calls[0].arguments, [[stored], 'transaction_validation:invalid']);
});

test('rejects with transaction_not_found and changes nothing when no shard holds the transaction', {timeout: 5000}, async t => {
    const {consensus, calls, notify} = setup(t, null);

    await assert.rejects(consensus.invalidateTransaction(TRANSACTION_ID), error => error === 'transaction_not_found');

    assert.deepEqual(calls, []);
    assert.equal(consensus.getRejectedTransactionList().has(TRANSACTION_ID), false);
    assert.equal(notify.mock.calls.length, 0);
});

test('invalidates the transaction in the database before the consensus is initialized', {timeout: 5000}, async t => {
    const stored                         = {
        transaction_id         : TRANSACTION_ID,
        transaction_input_list : [],
        transaction_output_list: [{address_key_identifier: 'key'}]
    };
    const {calls, walletUpdate, notify} = setup(t, stored);
    const consensus                     = new WalletTransactionConsensus(); // initialize() has not run: no consensus state
    t.mock.method(consensus, 'resetInputsSpentByTransaction', async transaction => calls.push(['reset_inputs', transaction.transaction_id]));
    t.mock.method(consensus, 'resetValidTransactionSpendingFromInvalidTransaction', async transaction => calls.push(['reset_spending', transaction.transaction_id]));

    const result = await consensus.invalidateTransaction(TRANSACTION_ID);

    assert.equal(result, stored);
    assert.deepEqual(calls, [
        ['invalidate', TRANSACTION_ID],
        ['clear_cache', TRANSACTION_ID],
        ['reset_inputs', TRANSACTION_ID],
        ['reset_spending', TRANSACTION_ID]
    ]);
    assert.equal(walletUpdate.mock.calls.length, 0); // it would start a validation without consensus state
    assert.deepEqual(notify.mock.calls[0].arguments, [[stored], 'transaction_validation:invalid']);
});

function setupInputReset(t, otherSpender, initialized = true) {
    const consensus  = new WalletTransactionConsensus();
    if (initialized) {
        consensus.clearState();
    }
    const freed      = [];
    const repository = {
        findInvalidInputSource      : async() => undefined,
        listTransactionSpendingOutput: async() => [
            {transaction_id: TRANSACTION_ID, status: 3, is_stable: 1, is_double_spend: 0},
            otherSpender
        ],
        resetTransaction             : async transactionID => freed.push(transactionID),
        updateTransactionOutput      : async transactionID => freed.push(transactionID),
        clearTransactionObjectCache  : () => {}
    };
    t.mock.method(console, 'log', () => {});
    t.mock.method(database, 'getRepository', () => repository);
    t.mock.method(database, 'applyShards', async callback => callback('shard_zero'));
    t.mock.method(database, 'applyShardZeroAndShardRepository', async(name, shardID, callback) => callback(repository));
    const transaction = {
        transaction_id        : TRANSACTION_ID,
        transaction_input_list: [{output_transaction_id: 'parent', output_position: 0, output_shard_id: 'shard_zero'}]
    };
    return {consensus, freed, repository, transaction};
}

test('frees a spent output when the only other spender was rejected by the consensus', {timeout: 5000}, async t => {
    const {consensus, freed, transaction} = setupInputReset(t, {transaction_id: 'rejected', status: 1, is_stable: 1, is_double_spend: 0});
    consensus._transactionValidationRejected.add('rejected');

    await consensus.resetInputsSpentByTransaction(transaction);

    assert.deepEqual(freed, ['parent']);
});

test('keeps a spent output spent while another live transaction spends it', {timeout: 5000}, async t => {
    const {consensus, freed, transaction} = setupInputReset(t, {transaction_id: 'live', status: 1, is_stable: 1, is_double_spend: 0});

    await consensus.resetInputsSpentByTransaction(transaction);

    assert.deepEqual(freed, []);
});

test('frees a spent output before the consensus is initialized', {timeout: 5000}, async t => {
    const {consensus, freed, transaction} = setupInputReset(t, {transaction_id: 'other', status: 3, is_stable: 1, is_double_spend: 0}, false);

    await consensus.resetInputsSpentByTransaction(transaction);

    assert.deepEqual(freed, ['parent']);
});

test('leaves a funding transaction alone when resetting it would restore an invalid output', {timeout: 5000}, async t => {
    const {consensus, freed, repository, transaction} = setupInputReset(t, {transaction_id: 'other', status: 3, is_stable: 1});
    const lookup = t.mock.method(repository, 'findInvalidInputSource', async([input], includeSiblingOutputs) =>
        includeSiblingOutputs ? input : undefined);

    await consensus.resetInputsSpentByTransaction(transaction);

    assert.equal(lookup.mock.callCount(), 1);
    assert.deepEqual(freed, []);
});
