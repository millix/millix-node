import {test} from 'node:test';
import assert from 'node:assert/strict';
import console from '../core/console';
import {WalletTransactionConsensus} from '../core/wallet/wallet-transaction-consensus';
import wallet from '../core/wallet/wallet';
import database from '../database/database';

const TRANSACTION_ID = 'dry5ncfKaBVDH6JjbtunS1hFM2MfHm6XdBBoM7b3NUdrrdmKF';

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
        getTransactionOutput         : async() => [{transaction_id: 'parent', output_position: 0, status: 1}],
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
    return {consensus, freed, transaction};
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
