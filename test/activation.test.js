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

describe('escrow activation (handshake version)', () => {
    test(`escrow transactions need a node from ${config.ESCROW_NODE_VERSION_MIN}`, () => {
        assert.equal(escrow.isNodeVersionAccepted(oldNode, [], [escrowOutput]), false);
        assert.equal(escrow.isNodeVersionAccepted(unknownNode, [], [escrowOutput]), false);
        assert.equal(escrow.isNodeVersionAccepted(newNode, [], [escrowOutput]), true);
        assert.equal(escrow.isNodeVersionAccepted(nextNode, [escrowInput(escrowAddress, 1)], []), true);
    });

    test('other transactions accept any version', () => {
        const output = {...walletAddress(payerWallet), amount: 1};
        assert.equal(escrow.isNodeVersionAccepted(oldNode, [], [output]), true);
        assert.equal(escrow.isNodeVersionAccepted(unknownNode, [], [output]), true);
    });

    test('consensus rounds pick only new nodes to validate an escrow transaction', () => {
        const transaction = funding(now());
        for (let i = 0; i < 20; i++) {
            const selected = walletTransactionConsensus._selectNodesForConsensusRound(4, new Set(), transaction);
            assert.deepEqual(new Set(selected), new Set([newNode, nextNode]));
        }
    });

    test('consensus rounds for other transactions keep old nodes', () => {
        const key         = newKey();
        const transaction = buildTransaction({
            inputList : [escrowInput(walletAddress(key), 2000)],
            outputList: [{...walletAddress(payerWallet), amount: 1000}],
            signerList: [key],
            version   : VERSION.transaction
        });
        const selected    = walletTransactionConsensus._selectNodesForConsensusRound(4, new Set(), transaction);
        // nodes that sent no version are left out as before
        assert.deepEqual(new Set(selected), new Set([oldNode, newNode, nextNode]));
    });

    test('an escrow transaction is propagated only to new nodes', () => {
        [oldNode, newNode, nextNode, unknownNode].forEach(ws => ws.sent = []);
        peer.transactionSend(funding(now()));
        assert.deepEqual([oldNode, newNode, nextNode, unknownNode].map(ws => ws.sent.length), [0, 1, 1, 0]);
        peer.transactionSendToNode(funding(now()), oldNode);
        assert.equal(oldNode.sent.length, 0);
    });

    test('other transactions are propagated to every node', () => {
        [oldNode, newNode, nextNode, unknownNode].forEach(ws => ws.sent = []);
        const key = newKey();
        peer.transactionSend(buildTransaction({
            inputList : [escrowInput(walletAddress(key), 2000)],
            outputList: [{...walletAddress(payerWallet), amount: 1000}],
            signerList: [key],
            version   : VERSION.transaction
        }));
        assert.deepEqual([oldNode, newNode, nextNode, unknownNode].map(ws => ws.sent.length), [1, 1, 1, 1]);
    });

    test('an escrow transaction is proxied only through new nodes', async() => {
        let candidateList;
        const restoreRepositories = stubRepositories({
            transaction: {
                getPeersAsProxyCandidate: nodeIDList => {
                    candidateList = nodeIDList;
                    return Promise.resolve([]);
                }
            }
        });
        try {
            await wallet.proxyTransaction([escrowInput(walletAddress(payerWallet), 201000)], [escrowOutput], {amount: 1000}, {}, {}, VERSION.transaction).catch(_ => _);
            assert.deepEqual(new Set(candidateList), new Set([newNode.nodeID, nextNode.nodeID]));
            await wallet.proxyTransaction([escrowInput(walletAddress(payerWallet), 201000)], [{...walletAddress(payee), amount: 200000}], {amount: 1000}, {}, {}, VERSION.transaction).catch(_ => _);
            assert.deepEqual(new Set(candidateList), new Set([oldNode.nodeID, newNode.nodeID, nextNode.nodeID]));
        }
        finally {
            restoreRepositories();
            restore.push(stubRepositories());
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
