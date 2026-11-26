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
