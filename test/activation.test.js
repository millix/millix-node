import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import config from '../core/config/config';
import network from '../net/network';
import peer from '../net/peer';
import wallet from '../core/wallet/wallet';
import walletTransactionConsensus from '../core/wallet/wallet-transaction-consensus';
import escrow from '../core/wallet/escrow';
import walletEscrow from '../core/wallet/wallet-escrow';
import vpnExit from '../net/vpn/vpn-exit';
import objectHash from '../core/crypto/object-hash';
import signature from '../core/crypto/signature';
import {
    buildTransaction,
    escrowInput,
    isValidTransaction,
    newKey,
    newNonce,
    now,
    setEscrowActivationDate,
    stubRepositories,
    VERSION,
    walletAddress
} from './helper';

const payer          = newKey();
const payee          = newKey();
const payerWallet    = newKey();
const activationDate = now() - 3600;

const terms         = {
    version         : config.ESCROW_TERMS_VERSION,
    payer_public_key: payer.public_key,
    payee_public_key: payee.public_key,
    amount          : 200000,
    portion_bytes   : 102400,
    portion_amount  : 20000,
    unlock_date     : activationDate - 60,
    nonce           : newNonce()
};
const escrowAddress = escrow.getEscrowAddress(terms);
const escrowOutput  = {
    address_base          : escrowAddress.address_base,
    address_version       : escrowAddress.address_version,
    address_key_identifier: escrowAddress.address_key_identifier,
    amount                : 200000
};

function funding(transactionDate) {
    return buildTransaction({
        inputList : [escrowInput(walletAddress(payerWallet), 201000, transactionDate - 60)],
        outputList: [escrowOutput],
        signerList: [payerWallet],
        version   : VERSION.transaction,
        transactionDate
    });
}

function refund(transactionDate) {
    return buildTransaction({
        inputList : [escrowInput(escrowAddress, 200000, transactionDate - 60)],
        outputList: [{...walletAddress(payerWallet), amount: 199000}],
        signerList: [payer],
        transactionDate,
        metadata  : {
            escrow: [
                {
                    address_base: escrowAddress.address_base,
                    terms,
                    action      : 'refund'
                }
            ]
        }
    });
}

function peerWS(version, nodeID = newKey().address_base) {
    return {
        nodeID,
        nodeConnectionReady: true,
        features           : version === undefined ? {} : {version},
        sent               : [],
        send(data) {
            this.sent.push(JSON.parse(data));
        }
    };
}

const restore = [];

function stubMethod(object, name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    Object.defineProperty(object, name, {
        value,
        configurable: true,
        writable    : true
    });
    restore.push(() => descriptor ? Object.defineProperty(object, name, descriptor) : delete object[name]);
}

const oldNode = peerWS('1.25.6');
const newNode = peerWS(config.ESCROW_NODE_VERSION_MIN);
const nextNode = peerWS('1.26.1');
const unknownNode = peerWS(undefined);

before(() => {
    restore.push(stubRepositories());
    restore.push(setEscrowActivationDate(activationDate));
    stubMethod(network, 'registeredClients', [oldNode, newNode, nextNode, unknownNode]);
});
after(() => restore.reverse().forEach(fn => fn()));


describe('escrow activation (transaction rules)', () => {
    test('the node version is at least the escrow node version', () => {
        assert.ok(escrow.isNodeVersionAccepted({features: {version: config.NODE_MILLIX_VERSION}}, [], [escrowOutput]));
    });

    test('refuses an escrow funding transaction dated one second before activation', () => {
        assert.equal(isValidTransaction(funding(activationDate - 1)), false);
    });

    test('accepts an escrow funding transaction dated at activation', () => {
        assert.equal(isValidTransaction(funding(activationDate)), true);
    });

    test('refuses an escrow spend dated before activation', () => {
        assert.equal(isValidTransaction(refund(activationDate - 1)), false);
        assert.equal(isValidTransaction(refund(activationDate)), true);
    });

    test('a transaction without escrow addresses is valid before activation', () => {
        const key = newKey();
        assert.equal(isValidTransaction(buildTransaction({
            inputList      : [escrowInput(walletAddress(key), 201000, activationDate - 120)],
            outputList     : [{...walletAddress(payerWallet), amount: 200000}],
            signerList     : [key],
            version        : VERSION.transaction,
            transactionDate: activationDate - 60
        })), true);
    });

    test('every node judges a transaction by its own date, not by when it arrives', () => {
        // a transaction dated before activation stays invalid after it
        assert.ok(now() > activationDate);
        assert.equal(isValidTransaction(funding(activationDate - 1)), false);
    });
});

function normalTransaction() {
    const key = newKey();
    return buildTransaction({
        inputList : [escrowInput(walletAddress(key), 2000)],
        outputList: [{...walletAddress(payerWallet), amount: 1000}],
        signerList: [key],
        version   : VERSION.transaction
    });
}

function proxyCandidateList(inputList, outputList) {
    let candidateList;
    const restoreRepositories = stubRepositories({
        transaction: {
            getPeersAsProxyCandidate: nodeIDList => {
                candidateList = nodeIDList;
                return Promise.resolve([]);
            }
        }
    });
    return wallet.proxyTransaction(inputList, outputList, {amount: 1000}, {}, {}, VERSION.transaction)
                 .catch(_ => _)
                 .then(() => {
                     restoreRepositories();
                     return new Set(candidateList);
                 });
}

describe('before the escrow activation nothing changes for older nodes', () => {
    let restoreDate;
    before(() => restoreDate = setEscrowActivationDate(now() + 3600));
    after(() => restoreDate());

    test('other transactions accept any version', () => {
        const output = {...walletAddress(payerWallet), amount: 1};
        assert.equal(escrow.isNodeVersionAccepted(oldNode, [], [output]), true);
        assert.equal(escrow.isNodeVersionAccepted(unknownNode, [], [output]), true);
        assert.equal(escrow.isNodeVersionAccepted(oldNode), true);
    });

    test('consensus rounds keep old nodes', () => {
        const selected = walletTransactionConsensus._selectNodesForConsensusRound(4, new Set(), normalTransaction());
        // nodes that sent no version are left out as before
        assert.deepEqual(new Set(selected), new Set([oldNode, newNode, nextNode]));
    });

    test('transactions are propagated to every node', () => {
        [oldNode, newNode, nextNode, unknownNode].forEach(ws => ws.sent = []);
        peer.transactionSend(normalTransaction());
        assert.deepEqual([oldNode, newNode, nextNode, unknownNode].map(ws => ws.sent.length), [1, 1, 1, 1]);
    });

    test('transactions are proxied through old nodes too', async() => {
        assert.deepEqual(await proxyCandidateList([escrowInput(walletAddress(payerWallet), 201000)], [{...walletAddress(payee), amount: 200000}]),
            new Set([oldNode.nodeID, newNode.nodeID, nextNode.nodeID]));
    });

    test('escrow transactions would still need new nodes (they are invalid before activation anyway)', () => {
        assert.equal(escrow.isNodeVersionAccepted(oldNode, [], [escrowOutput]), false);
    });
});

describe('from the escrow activation on older nodes are refused everything', () => {
    test(`every transaction needs a node from ${config.ESCROW_NODE_VERSION_MIN}`, () => {
        const output = {...walletAddress(payerWallet), amount: 1};
        assert.equal(escrow.isNodeVersionAccepted(oldNode, [], [escrowOutput]), false);
        assert.equal(escrow.isNodeVersionAccepted(oldNode, [], [output]), false);
        assert.equal(escrow.isNodeVersionAccepted(unknownNode), false);
        assert.equal(escrow.isNodeVersionAccepted(newNode, [], [output]), true);
        assert.equal(escrow.isNodeVersionAccepted(nextNode, [escrowInput(escrowAddress, 1)], []), true);
    });

    test('consensus rounds pick only new nodes, for escrow and other transactions', () => {
        for (const transaction of [funding(now()), normalTransaction()]) {
            for (let i = 0; i < 10; i++) {
                assert.deepEqual(new Set(walletTransactionConsensus._selectNodesForConsensusRound(4, new Set(), transaction)), new Set([newNode, nextNode]));
            }
        }
    });

    test('transactions are propagated only to new nodes', () => {
        for (const transaction of [funding(now()), normalTransaction()]) {
            [oldNode, newNode, nextNode, unknownNode].forEach(ws => ws.sent = []);
            peer.transactionSend(transaction);
            assert.deepEqual([oldNode, newNode, nextNode, unknownNode].map(ws => ws.sent.length), [0, 1, 1, 0]);
            peer.transactionSendToNode(transaction, oldNode);
            assert.equal(oldNode.sent.length, 0);
        }
    });

    test('transactions are proxied only through new nodes', async() => {
        assert.deepEqual(await proxyCandidateList([escrowInput(walletAddress(payerWallet), 201000)], [escrowOutput]), new Set([newNode.nodeID, nextNode.nodeID]));
        assert.deepEqual(await proxyCandidateList([escrowInput(walletAddress(payerWallet), 201000)], [{...walletAddress(payee), amount: 200000}]), new Set([newNode.nodeID, nextNode.nodeID]));
    });

    test('a node below the version is disconnected at the handshake, a new node is registered', () => {
        const registeredList = [];
        const register       = network._registerWebsocketToNodeID;
        network._registerWebsocketToNodeID = ws => {
            registeredList.push(ws);
            return false;
        };
        try {
            const handshake = version => {
                const ws = {
                    terminated: false,
                    terminate() {
                        this.terminated = true;
                    }
                };
                network._onNodeHandshake({
                    node_id          : newKey().address_base,
                    connection_id    : 'connection',
                    node_network_test: config.MODE_TEST_NETWORK,
                    node_feature_set : {version}
                }, ws);
                return ws;
            };
            const old  = handshake('1.25.6');
            assert.equal(old.terminated, true);
            assert.equal(registeredList.includes(old), false);
            const next = handshake(config.ESCROW_NODE_VERSION_MIN);
            assert.equal(next.terminated, false);
            assert.equal(registeredList.includes(next), true);
        }
        finally {
            network._registerWebsocketToNodeID = register;
        }
    });
});

describe('escrow activation (wallet and exit node)', () => {
    test('a payer cannot fund an escrow before activation', async() => {
        const restoreDate = setEscrowActivationDate(now() + 3600);
        try {
            await assert.rejects(walletEscrow.createEscrow(payee.public_key, payee.address_base, 102400, 20000, 10, now() + 7200), error => error === 'escrow_not_active');
        }
        finally {
            restoreDate();
        }
    });

    test('an exit node refuses escrow passes before activation', async() => {
        const restoreDate = setEscrowActivationDate(now() + 3600);
        const state       = {challenge: 'c'.repeat(64)};
        const passTerms   = {
            ...terms,
            payee_public_key: payee.public_key,
            portion_bytes   : config.VPN_ESCROW_PORTION_BYTES,
            portion_amount  : config.VPN_ESCROW_PORTION_AMOUNT,
            amount          : config.VPN_ESCROW_PORTION_AMOUNT * 10,
            unlock_date     : now() + 24 * 3600
        };
        try {
            await assert.rejects(vpnExit._authenticate(state, {
                pass               : {terms: passTerms},
                challenge_signature: signature.sign(objectHash.getHashBuffer({challenge: state.challenge, node_id: payee.address_base}), payer.private_key)
            }), error => error === 'escrow_not_active');
        }
        finally {
            restoreDate();
        }
    });
});
