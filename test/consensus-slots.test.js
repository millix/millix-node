import {test} from 'node:test';
import assert from 'node:assert/strict';
import console from '../core/console';
import config from '../core/config/config';
import {WalletTransactionConsensus} from '../core/wallet/wallet-transaction-consensus';
import wallet from '../core/wallet/wallet';
import walletUtils from '../core/wallet/wallet-utils';
import database from '../database/database';
import network from '../net/network';
import peer from '../net/peer';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject  = rejectPromise;
    });
    return {promise, resolve, reject};
}

function transaction(transactionID) {
    const now = Math.floor(Date.now() / 1000);
    return {
        transaction_id         : transactionID,
        transaction_date       : now - 60,
        create_date            : now - 60,
        version                : '0c0',
        transaction_output_list: []
    };
}

function setup(t) {
    const consensus = new WalletTransactionConsensus();
    consensus.clearState();
    const reads      = [];
    const rounds     = [];
    const repository = {
        getWalletUnstableTransactions: () => {
            const read = deferred();
            reads.push({
                ...read,
                activeRounds: consensus.getActiveConsensusRoundCount(),
                reservations: consensus._validationReservations.size
            });
            return read.promise;
        },
        getTransactionOutputs         : async() => [],
        listTransactionOutput         : async() => [],
        findUnstableTransaction       : async() => [],
        timeoutTransaction            : async() => {},
        clearTransactionObjectCache: () => {}
    };
    const log = t.mock.method(console, 'log', () => {});
    t.mock.method(database, 'getRepository', () => repository);
    t.mock.method(database, 'applyShards', async callback => callback());
    t.mock.method(network, 'hasOutboundConnectionsSlotAvailable', () => true);
    t.mock.method(wallet, '_checkIfWalletUpdate', () => {});
    const startRound = t.mock.method(consensus, '_startConsensusRound', transactionID => {
        const round = deferred();
        rounds.push({...round, transactionID});
        return round.promise;
    });
    return {consensus, reads, rounds, repository, log, startRound};
}

const flush = () => new Promise(resolve => setImmediate(resolve));

function assertSlots(consensus, activeRounds, reservations) {
    assert.equal(consensus.getActiveConsensusRoundCount(), activeRounds);
    assert.equal(consensus._validationReservations.size, reservations);
    assert.ok(activeRounds + reservations <= config.CONSENSUS_VALIDATION_PARALLEL_PROCESS_MAX);
}

async function select(read, transactionID) {
    read.resolve([transaction(transactionID)]);
    await flush();
}

test('consensus whitelist filters eligible peers by node ID across connection directions', t => {
    const consensus = new WalletTransactionConsensus();
    const nodeRegistry = network._nodeRegistry;
    const whitelist = config.CONSENSUS_WHITELIST;
    t.after(() => {
        network._nodeRegistry = nodeRegistry;
        config.CONSENSUS_WHITELIST = whitelist;
    });

    const ready = {nodeConnectionReady: true, features: {version: config.NODE_MILLIX_VERSION}};
    const inbound = {...ready, nodeID: 'inbound', inBound: true};
    const outbound = {...ready, nodeID: 'outbound', outBound: true};
    const bidirectional = {...ready, nodeID: 'bidirectional', inBound: true, bidirectional: true};
    const unlisted = {...ready, nodeID: 'unlisted', inBound: true};
    const unready = {...ready, nodeID: 'unready', outBound: true, nodeConnectionReady: false};
    const old = {...ready, nodeID: 'old', outBound: true, features: {version: '1.21.0'}};
    network._nodeRegistry = {
        inbound      : [inbound],
        outbound     : [outbound],
        bidirectional: [bidirectional],
        unlisted     : [unlisted],
        unready      : [unready],
        old          : [old]
    };

    assert.deepEqual(whitelist, []);
    assert.deepEqual(new Set(consensus._selectNodesForConsensusRound(6)), new Set([inbound, outbound, bidirectional, unlisted]));

    config.CONSENSUS_WHITELIST = ['inbound', 'outbound', 'bidirectional', 'unready', 'old'];
    assert.deepEqual(new Set(consensus._selectNodesForConsensusRound(6)), new Set([inbound, outbound, bidirectional]));
    assert.deepEqual(consensus._selectNodesForConsensusRound(6, new Set(['inbound', 'outbound', 'bidirectional'])), []);
});

test('consensus whitelist accepts votes only from listed ready peers', t => {
    const whitelist = config.CONSENSUS_WHITELIST;
    config.CONSENSUS_WHITELIST = ['inbound', 'outbound'];
    t.after(() => config.CONSENSUS_WHITELIST = whitelist);

    const consensus = new WalletTransactionConsensus();
    consensus.clearState();
    const replies = {};
    consensus._consensusRoundState.pending = {
        active                  : true,
        consensus_round_count   : 0,
        consensus_round_response: [replies]
    };
    const vote = {transaction_id: 'pending', valid: true};

    consensus.processTransactionValidationResponse(vote, {nodeID: 'unlisted', outBound: true, nodeConnectionReady: true});
    consensus.processTransactionValidationResponse(vote, {nodeID: 'inbound', inBound: true, nodeConnectionReady: false});
    assert.deepEqual(replies, {});

    consensus.processTransactionValidationResponse(vote, {nodeID: 'inbound', inBound: true, bidirectional: true, nodeConnectionReady: true});
    consensus.processTransactionValidationResponse(vote, {nodeID: 'outbound', outBound: true, nodeConnectionReady: true});
    assert.deepEqual(replies, {inbound: {response: vote}, outbound: {response: vote}});
});

test('concurrent calls keep their reservations when an active round finishes during selection', {timeout: 5000}, async t => {
    const {consensus, reads, rounds, log} = setup(t);

    const first = consensus.doValidateTransaction();
    await select(reads[0], 'first');
    const second = consensus.doValidateTransaction();
    assertSlots(consensus, 1, 1);

    consensus._consensusRoundState.finalizing = {active: false};
    await consensus.doValidateTransaction();
    const capacityLog = log.mock.calls.find(({arguments: args}) => args[0].includes('validation capacity reached'));
    assert.deepEqual(capacityLog?.arguments[1], {
        limit               : config.CONSENSUS_VALIDATION_PARALLEL_PROCESS_MAX,
        activeTransactionIDs: ['first'],
        reservations        : 1
    });

    rounds[0].reject(new Error('first round ended'));
    await first;
    assertSlots(consensus, 0, 1);

    const third = consensus.doValidateTransaction();
    assertSlots(consensus, 0, 2);
    await consensus.doValidateTransaction();
    assert.equal(reads.length, 2);

    await select(reads[1], 'second');
    assertSlots(consensus, 1, 1);
    assert.equal(reads[2].activeRounds, 1, 'promotion is visible when the mutex admits the next selection');
    assert.equal(reads[2].reservations, 1);
    await consensus.doValidateTransaction();

    await select(reads[2], 'third');
    assertSlots(consensus, 2, 0);
    await consensus.doValidateTransaction();
    assert.equal(reads.length, 3);
    assert.deepEqual(rounds.map(round => round.transactionID), ['first', 'second', 'third']);

    rounds[1].reject(new Error('second round ended'));
    await second;
    assert.equal(consensus.isRunningValidationForWalletTransaction(), true);
    const fourth = consensus.doValidateTransaction();
    assertSlots(consensus, 1, 1);
    await select(reads[3], 'fourth');
    assertSlots(consensus, 2, 0);
    rounds[2].reject(new Error('third round ended'));
    rounds[3].reject(new Error('fourth round ended'));
    await Promise.all([third, fourth]);
    assertSlots(consensus, 0, 0);
    assert.equal(consensus.isRunningValidationForWalletTransaction(), false);
});

test('empty selection, retry deferral, and selection failure release the reservation', {timeout: 5000}, async t => {
    const {consensus, reads, rounds} = setup(t);
    consensus._lastTransactionValidatedTimestamp = Date.now();
    const empty = consensus.doValidateTransaction();
    reads[0].resolve([]);
    await empty;
    assertSlots(consensus, 0, 0);
    assert.equal(consensus._lastTransactionValidatedTimestamp, undefined);

    consensus.getRetryTransactionList().deferred = Date.now() + 60000;
    const retry = consensus.doValidateTransaction();
    await select(reads[1], 'deferred');
    await retry;
    assertSlots(consensus, 0, 0);
    assert.equal(rounds.length, 0);

    const applyShards = t.mock.method(database, 'applyShards');
    applyShards.mock.mockImplementationOnce(() => {
        throw new Error('selection failed');
    });
    await consensus.doValidateTransaction();
    assertSlots(consensus, 0, 0);

    const resumed = consensus.doValidateTransaction();
    await select(reads[2], 'ready');
    assertSlots(consensus, 1, 0);
    rounds[0].reject(new Error('round ended'));
    await resumed;
    assertSlots(consensus, 0, 0);
});

test('reset discards an in-progress selection and a queued selection', {timeout: 5000}, async t => {
    const {consensus, reads, rounds} = setup(t);
    const selecting = consensus.doValidateTransaction();
    const queued = consensus.doValidateTransaction();
    assertSlots(consensus, 0, 2);

    consensus.clearState();
    const replacement = consensus.doValidateTransaction();
    assertSlots(consensus, 0, 1);
    reads[0].resolve([transaction('stale')]);
    await Promise.all([selecting, queued]);
    assertSlots(consensus, 0, 1);
    assert.equal(reads.length, 2);
    assert.deepEqual(consensus.getRetryTransactionList(), {});
    assert.equal(rounds.length, 0);

    await select(reads[1], 'current');
    assert.deepEqual(rounds.map(round => round.transactionID), ['current']);
    rounds[0].reject(new Error('round ended'));
    await replacement;
    assertSlots(consensus, 0, 0);
});

test('late round cleanup after a reset preserves the replacement for the same transaction', {timeout: 5000}, async t => {
    const {consensus, reads, rounds} = setup(t);
    const original = consensus.doValidateTransaction();
    await select(reads[0], 'same');

    consensus.clearState();
    const replacement = consensus.doValidateTransaction();
    await select(reads[1], 'same');
    const replacementRound = consensus._consensusRoundState.same;
    rounds[0].reject(new Error('stale round ended'));
    await original;
    assert.equal(consensus._consensusRoundState.same, replacementRound);
    assertSlots(consensus, 1, 0);

    rounds[1].reject(new Error('replacement round ended'));
    await replacement;
    assertSlots(consensus, 0, 0);
});

test('a peer request completing after reset only belongs to its original round', {timeout: 5000}, async t => {
    const {consensus, reads, repository, startRound} = setup(t);
    startRound.mock.restore();
    repository.getTransactionObject = async transactionID => transaction(transactionID);
    repository.normalizeTransactionObject = value => value;
    t.mock.method(database, 'firstShards', async callback => callback());
    t.mock.method(walletUtils, 'verifyTransaction', async() => [true]);
    const socket = {nodeID: 'peer'};
    t.mock.method(consensus, '_selectNodesForConsensusRound', () => [socket]);
    t.mock.method(global, 'setTimeout', () => {});
    const requests = [];
    t.mock.method(peer, 'transactionValidationRequest', () => {
        const request = deferred();
        requests.push(request);
        return request.promise;
    });

    const original = consensus.doValidateTransaction();
    await select(reads[0], 'same');
    assert.equal(requests.length, 1);
    consensus.clearState();
    await original;

    const replacement = consensus.doValidateTransaction();
    await select(reads[1], 'same');
    assert.equal(requests.length, 2);
    const replacementRound = consensus._consensusRoundState.same;
    const pendingResponse = replacementRound.consensus_round_response[0].peer;
    assert.ok(pendingResponse);

    requests[0].resolve({type: 'node_not_available'});
    await flush();
    assert.equal(replacementRound.consensus_round_response[0].peer, pendingResponse);
    assert.equal(replacementRound.consensus_round_node_discard.has(socket.nodeID), false);
    assert.equal(requests.length, 2);

    consensus.clearState();
    await replacement;
    requests[1].resolve({type: 'validation_start'});
    await flush();
});

test('watchdog restarts the network during selection', {timeout: 5000}, async t => {
    const {consensus, reads, rounds} = setup(t);
    const stop = t.mock.method(network, 'stop', async() => {});
    const initialize = t.mock.method(network, 'initialize', async() => {});
    const scheduleRestart = t.mock.method(global, 'setTimeout', () => {});
    const selecting = consensus.doValidateTransaction();
    consensus._lastTransactionValidatedTimestamp = Date.now() - 2 * config.CONSENSUS_WATCHDOG_WAIT_TIME_MAX - 1;

    await consensus.doConsensusTransactionValidationWatchDog();
    assert.equal(stop.mock.callCount(), 1);
    assert.equal(scheduleRestart.mock.callCount(), 1);
    const [restart, delay] = scheduleRestart.mock.calls[0].arguments;
    assert.equal(delay, 5000);
    await restart();
    assert.equal(initialize.mock.callCount(), 1);

    reads[0].resolve([transaction('stale')]);
    await selecting;
    assertSlots(consensus, 0, 0);
    assert.equal(rounds.length, 0);
});

test('watchdog retries peer requests only after the callback is installed', {timeout: 5000}, async t => {
    const {consensus, reads, rounds} = setup(t);
    const validation = consensus.doValidateTransaction();
    await select(reads[0], 'pending');
    const round = consensus._consensusRoundState.pending;
    const oldTimestamp = Date.now() - 16000;
    round.timestamp = oldTimestamp;

    await consensus.doConsensusTransactionValidationWatchDog();
    assert.equal(round.timestamp, oldTimestamp);
    round.requestPeerValidation = t.mock.fn();
    await consensus.doConsensusTransactionValidationWatchDog();
    assert.equal(round.requestPeerValidation.mock.callCount(), 1);
    assert.ok(round.timestamp > oldTimestamp);

    rounds[0].reject(new Error('round ended'));
    await validation;
    assert.equal(consensus._validationWatchDogState.pending, undefined);
    assertSlots(consensus, 0, 0);
});

test('failed not-found notification settles the round and releases its state', {timeout: 5000}, async t => {
    const {consensus, reads, rounds, repository, log} = setup(t);
    const timeoutTransaction = t.mock.method(repository, 'timeoutTransaction');
    const notificationError = new Error('wallet notification failed');
    t.mock.method(wallet, 'notifyTransactionChanged', () => {
        throw notificationError;
    });
    const scheduleNext = t.mock.method(global, 'setTimeout', () => {});
    const validation = consensus.doValidateTransaction();
    await select(reads[0], 'missing-input');
    const round = consensus._consensusRoundState['missing-input'];
    round.transaction = transaction('missing-input');
    round.resolve = rounds[0].resolve;
    round.consensus_round_not_found_count = config.CONSENSUS_ROUND_NOT_FOUND_MAX - 1;
    const response = {
        transaction_id     : 'missing-input',
        transaction_id_fail: 'input',
        valid              : false,
        cause              : 'transaction_not_found'
    };

    for (let index = 0; index < config.CONSENSUS_ROUND_NODE_COUNT; index++) {
        await consensus.processTransactionValidationResponse(response, {nodeID: `peer-${index}`});
    }

    await validation;
    assert.equal(timeoutTransaction.mock.callCount(), 1);
    assert.equal(scheduleNext.mock.callCount(), 1);
    assert.equal(consensus._consensusRoundState['missing-input'], undefined);
    assert.ok(consensus.getRejectedTransactionList().has('missing-input'));
    assert.ok(log.mock.calls.some(({arguments: args}) => args[2] === notificationError));
    assertSlots(consensus, 0, 0);
});
