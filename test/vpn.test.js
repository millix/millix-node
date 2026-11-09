import {after, afterEach, before, beforeEach, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import dns from 'dns';
import http from 'http';
import config from '../core/config/config';
import network from '../net/network';
import vpnExit from '../net/vpn/vpn-exit';
import vpnClient from '../net/vpn/vpn-client';
import {isPrivateAddress, resolvePublicAddress} from '../net/vpn/address-filter';
import wallet from '../core/wallet/wallet';
import walletUtils from '../core/wallet/wallet-utils';
import escrow from '../core/wallet/escrow';
import walletEscrow from '../core/wallet/wallet-escrow';
import objectHash from '../core/crypto/object-hash';
import signature from '../core/crypto/signature';
import {escrowInput, newKey, newNonce, now, stubRepositories} from './helper';

const exitNode = newKey();
const pass     = newKey();
const other    = newKey();

function vpnTerms(overrides = {}) {
    return {
        version         : config.ESCROW_TERMS_VERSION,
        payer_public_key: pass.public_key,
        payee_public_key: exitNode.public_key,
        amount          : config.VPN_ESCROW_PORTION_AMOUNT * 20,
        portion_bytes   : config.VPN_ESCROW_PORTION_BYTES,
        portion_amount  : config.VPN_ESCROW_PORTION_AMOUNT,
        unlock_date     : now() + 24 * 3600,
        nonce           : newNonce(),
        ...overrides
    };
}

const restore = [];

function stubMethod(object, name, value, restoreList = restore) {
    const original = object[name];
    object[name]   = value;
    restoreList.push(() => object[name] = original);
}

before(() => {
    stubMethod(network, 'nodeID', exitNode.address_base);
    stubMethod(network, 'nodePublicKey', exitNode.public_key);
});
after(() => restore.reverse().forEach(fn => fn()));


describe('address filter', () => {
    const privateList = [
        // ipv4 ranges, first and last address of each
        '0.0.0.0', '0.255.255.255',
        '10.0.0.0', '10.255.255.255',
        '100.64.0.0', '100.127.255.255',
        '127.0.0.1', '127.255.255.255',
        '169.254.169.254',
        '172.16.0.0', '172.31.255.255',
        '192.0.0.1', '192.0.2.1',
        '192.168.0.0', '192.168.255.255',
        '198.18.0.0', '198.19.255.255',
        '198.51.100.1', '203.0.113.1',
        '224.0.0.1', '239.255.255.255',
        '240.0.0.1', '255.255.255.255',
        // ipv6
        '::', '::1',
        'fe80::1', 'febf::1',
        'fc00::1', 'fd12:3456::1',
        'ff02::1',
        '2001:db8::1',
        '64:ff9b::a00:1',
        '100::1',
        // ipv4-mapped ipv6, dotted and hex
        '::ffff:127.0.0.1', '::ffff:7f00:1',
        '::ffff:10.0.0.1', '::ffff:a00:1',
        '::ffff:192.168.1.1', '::ffff:c0a8:101',
        '::ffff:169.254.169.254', '::FFFF:A9FE:A9FE',
        // not an address
        'localhost', 'example.com', ''
    ];
    const publicList  = [
        '1.1.1.1', '8.8.8.8', '93.184.215.14',
        '9.255.255.255', '11.0.0.0',
        '100.63.255.255', '100.128.0.0',
        '172.15.255.255', '172.32.0.0',
        '192.167.255.255', '192.169.0.0',
        '198.17.255.255', '198.20.0.0',
        '223.255.255.255',
        '2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450::1',
        'fec0::1',
        '::ffff:8.8.8.8', '::ffff:808:808', '::ffff:1.1.1.1'
    ];

    for (const address of privateList) {
        test(`${address || '(empty)'} is private`, () => assert.equal(isPrivateAddress(address), true));
    }
    for (const address of publicList) {
        test(`${address} is public`, () => assert.equal(isPrivateAddress(address), false));
    }
});

describe('site name resolution', () => {
    let lookup;
    let lookupCount;

    beforeEach(() => {
        lookup      = dns.lookup;
        lookupCount = 0;
    });
    afterEach(() => dns.lookup = lookup);

    function answer(addressList, error = null) {
        dns.lookup = (hostname, options, callback) => {
            lookupCount++;
            callback(error, addressList);
        };
    }

    test('an address is checked without a lookup', async() => {
        answer([]);
        assert.deepEqual(await resolvePublicAddress('8.8.8.8'), {address: '8.8.8.8', family: 4});
        assert.deepEqual(await resolvePublicAddress('[2606:4700:4700::1111]'), {address: '2606:4700:4700::1111', family: 6});
        await assert.rejects(resolvePublicAddress('127.0.0.1'), error => error === 'private_address');
        await assert.rejects(resolvePublicAddress('[::1]'), error => error === 'private_address');
        await assert.rejects(resolvePublicAddress('[::ffff:10.0.0.1]'), error => error === 'private_address');
        assert.equal(lookupCount, 0);
    });

    for (const host of ['localhost', 'LOCALHOST', 'app.localhost', 'bad_name.com', 'a b.com', 'host:80']) {
        test(`refuses ${host} without a lookup`, async() => {
            answer([{address: '8.8.8.8', family: 4}]);
            await assert.rejects(resolvePublicAddress(host), error => error === 'private_address');
            assert.equal(lookupCount, 0);
        });
    }

    test('refuses a name that resolves to a private address', async() => {
        answer([{address: '192.168.1.1', family: 4}]);
        await assert.rejects(resolvePublicAddress('router.example.com'), error => error === 'private_address');
    });

    test('refuses a name when any of its addresses is private', async() => {
        answer([{address: '93.184.215.14', family: 4}, {address: '::1', family: 6}]);
        await assert.rejects(resolvePublicAddress('mixed.example.com'), error => error === 'private_address');
    });

    test('refuses a name that resolves to an ipv4-mapped private address', async() => {
        answer([{address: '::ffff:7f00:1', family: 6}]);
        await assert.rejects(resolvePublicAddress('mapped.example.com'), error => error === 'private_address');
    });

    test('returns the checked address, preferring ipv4', async() => {
        answer([{address: '2606:2800:21f:cb07:6820:80da:af6b:8b2c', family: 6}, {address: '93.184.215.14', family: 4}]);
        assert.deepEqual(await resolvePublicAddress('example.com'), {address: '93.184.215.14', family: 4});
    });

    test('reports a name that does not resolve', async() => {
        answer(undefined, new Error('ENOTFOUND'));
        await assert.rejects(resolvePublicAddress('nothing.example.com'), error => error === 'host_not_found');
    });
});

describe('pass challenge (exit node)', () => {
    let escrowRecordMap;
    let lockedAmount;
    let restoreRepositories;

    beforeEach(() => {
        escrowRecordMap = new Map();
        lockedAmount    = null;
        vpnExit.sessionMap.clear();
        restoreRepositories = stubRepositories({
            escrow: {
                getEscrow: addressBase => Promise.resolve(escrowRecordMap.get(addressBase) || null)
            }
        });
    });
    afterEach(() => restoreRepositories());

    before(() => {
        stubMethod(walletEscrow, 'getEscrowInputList', terms => {
            const amount = lockedAmount === null ? terms.amount : lockedAmount;
            return Promise.resolve(amount > 0 ? [escrowInput(escrow.getEscrowAddress(terms), amount)] : []);
        });
        stubMethod(walletEscrow, 'requestFundingTransaction', () => undefined);
        stubMethod(walletEscrow, 'addPayeeEscrow', terms => {
            const escrowAddress = escrow.getEscrowAddress(terms);
            const escrowRecord  = escrowRecordMap.get(escrowAddress.address_base) || {
                escrow_address     : escrowAddress.address,
                address_base       : escrowAddress.address_base,
                role               : 'payee',
                terms,
                receipt_total_bytes: 0,
                receipt_sequence   : 0
            };
            escrowRecordMap.set(escrowAddress.address_base, escrowRecord);
            return Promise.resolve(escrowRecord);
        });
    });

    function newState() {
        return {
            session_id         : `session-${Math.random()}`,
            session            : {close: () => undefined, destroy: () => undefined, destroyed: true},
            challenge          : 'c'.repeat(64),
            authenticated      : false,
            bytes_sent         : 0,
            bytes_received     : 0,
            receipt_total_bytes: 0,
            receipt_sequence   : 0,
            site_list          : new Set(),
            closed             : false
        };
    }

    function signChallenge(state, key = pass, nodeID = exitNode.address_base) {
        return signature.sign(objectHash.getHashBuffer({
            challenge: state.challenge,
            node_id  : nodeID
        }), key.private_key);
    }

    function authenticate(state, terms, challengeSignature = signChallenge(state)) {
        return vpnExit._authenticate(state, {
            pass               : {
                terms,
                funding_transaction_id: 'F'.repeat(50)
            },
            challenge_signature: challengeSignature
        });
    }

    test('accepts the challenge signed by the pass key of a funded escrow that pays this node', async() => {
        const state  = newState();
        const terms  = vpnTerms();
        const result = await authenticate(state, terms);
        assert.equal(state.authenticated, true);
        assert.equal(state.challenge, null, 'a challenge is used once');
        assert.equal(state.pass_public_key, pass.public_key);
        assert.equal(result.escrow_address, escrow.getEscrowAddress(terms).address);
        assert.equal(result.bytes_covered, 20 * config.VPN_ESCROW_PORTION_BYTES);
        assert.equal(result.receipt_gap_max, config.VPN_RECEIPT_GAP_BYTES_MAX);
    });

    test('refuses a challenge signed by another key', async() => {
        const state = newState();
        await assert.rejects(authenticate(state, vpnTerms(), signChallenge(state, other)), error => error === 'challenge_signature_invalid');
        assert.equal(state.authenticated, false);
    });

    test('refuses a signature over an older challenge', async() => {
        const state     = newState();
        const replay    = signChallenge(state);
        state.challenge = 'd'.repeat(64);
        await assert.rejects(authenticate(state, vpnTerms(), replay), error => error === 'challenge_signature_invalid');
    });

    test('refuses a challenge signed for another exit node', async() => {
        const state = newState();
        await assert.rejects(authenticate(state, vpnTerms(), signChallenge(state, pass, other.address_base)), error => error === 'challenge_signature_invalid');
    });

    test('refuses a pass before a challenge was asked for', async() => {
        const state     = newState();
        const signed    = signChallenge(state);
        state.challenge = null;
        await assert.rejects(authenticate(state, vpnTerms(), signed), error => error === 'challenge_not_found');
    });

    test('refuses a second pass on an authenticated session', async() => {
        const state = newState();
        await authenticate(state, vpnTerms());
        state.challenge = 'e'.repeat(64);
        await assert.rejects(authenticate(state, vpnTerms()), error => error === 'session_already_authenticated');
    });

    test('refuses an escrow that pays another node', async() => {
        await assert.rejects(authenticate(newState(), vpnTerms({payee_public_key: other.public_key})), error => error === 'pass_not_for_this_node');
    });

    test('refuses malformed terms', async() => {
        await assert.rejects(authenticate(newState(), {...vpnTerms(), nonce: 'x'}), error => error === 'pass_invalid');
    });

    test('refuses a price other than this node\'s', async() => {
        await assert.rejects(authenticate(newState(), vpnTerms({portion_bytes: config.VPN_ESCROW_PORTION_BYTES * 2})), error => error === 'pass_price_not_accepted');
        await assert.rejects(authenticate(newState(), vpnTerms({portion_amount: config.VPN_ESCROW_PORTION_AMOUNT - 1})), error => error === 'pass_price_not_accepted');
    });

    test('refuses an escrow that unlocks too soon or too late', async() => {
        await assert.rejects(authenticate(newState(), vpnTerms({unlock_date: now() + config.VPN_ESCROW_UNLOCK_REMAINING_MIN - 60})), error => error === 'pass_unlock_date_not_accepted');
        await assert.rejects(authenticate(newState(), vpnTerms({unlock_date: now() + config.ESCROW_UNLOCK_DURATION_MAX + 60})), error => error === 'pass_unlock_date_not_accepted');
    });

    test('refuses an escrow that is not funded, or not funded enough', async() => {
        lockedAmount = 0;
        await assert.rejects(authenticate(newState(), vpnTerms()), error => error === 'escrow_not_funded');
        lockedAmount = config.VPN_ESCROW_PORTION_AMOUNT * 20 - 1;
        await assert.rejects(authenticate(newState(), vpnTerms()), error => error === 'escrow_not_funded');
    });

    test('refuses an escrow whose data is used up', async() => {
        const terms = vpnTerms();
        escrowRecordMap.set(escrow.getEscrowAddress(terms).address_base, {receipt_total_bytes: escrow.getBytesCovered(terms)});
        lockedAmount = 0.5 * terms.amount;
        await assert.rejects(authenticate(newState(), terms), error => error === 'pass_data_used');
    });

    test('refuses a second connection on the same escrow', async() => {
        const terms = vpnTerms();
        const first = newState();
        vpnExit.sessionMap.set(first.session_id, first);
        await authenticate(first, terms);
        await assert.rejects(authenticate(newState(), terms), error => error === 'pass_already_connected');
    });

    test('a new session continues from the escrow\'s latest receipt', async() => {
        const terms = vpnTerms();
        escrowRecordMap.set(escrow.getEscrowAddress(terms).address_base, {
            ...escrow.getEscrowAddress(terms),
            terms,
            receipt_total_bytes: 3000000,
            receipt_sequence   : 7
        });
        const state  = newState();
        const result = await authenticate(state, terms);
        assert.equal(result.receipt_total_bytes, 3000000);
        assert.equal(result.receipt_sequence, 7);
        assert.equal(state.bytes_sent, 3000000);
    });
});

describe('receipts and the unreceipted gap (exit node)', () => {
    const terms         = vpnTerms({amount: config.VPN_ESCROW_PORTION_AMOUNT * 100});
    const escrowAddress = escrow.getEscrowAddress(terms);
    let storedList;

    before(() => {
        stubMethod(walletEscrow, 'addReceipt', (escrowRecord, receipt, receiptSignature) => {
            storedList.push({receipt, receiptSignature});
            return Promise.resolve(true);
        });
    });

    function authenticatedState() {
        storedList  = [];
        const state = {
            session_id         : `session-${Math.random()}`,
            session            : {close: () => undefined, destroy: () => undefined, destroyed: true},
            authenticated      : true,
            escrow_record      : {
                ...escrowAddress,
                terms
            },
            bytes_sent         : 0,
            bytes_received     : 0,
            bytes_covered      : escrow.getBytesCovered(terms),
            receipt_total_bytes: 0,
            receipt_sequence   : 0,
            site_list          : new Set(),
            closed             : false
        };
        vpnExit.sessionMap.set(state.session_id, state);
        return state;
    }

    function signedReceipt(totalBytes, sequence, key = pass, overrides = {}) {
        const receipt = {
            version            : config.ESCROW_RECEIPT_VERSION,
            escrow_address_base: escrowAddress.address_base,
            node_id            : exitNode.address_base,
            total_bytes        : totalBytes,
            sequence,
            receipt_date       : now(),
            ...overrides
        };
        return {
            receipt,
            signature: escrow.signReceipt(receipt, key.private_key)
        };
    }

    test('a receipt is valid only for its escrow, its exit node and the pass key', () => {
        const {receipt, signature: receiptSignature} = signedReceipt(1000, 1);
        assert.equal(escrow.isValidReceipt(terms, receipt, receiptSignature, escrowAddress.address_base), true);
        assert.equal(escrow.isValidReceipt(terms, receipt, receiptSignature, other.address_base), false);
        assert.equal(escrow.isValidReceipt(terms, {...receipt, total_bytes: 2000}, receiptSignature, escrowAddress.address_base), false);
        assert.equal(escrow.isValidReceipt(vpnTerms({payee_public_key: other.public_key}), receipt, receiptSignature, escrowAddress.address_base), false);
        const byOther = signedReceipt(1000, 1, other);
        assert.equal(escrow.isValidReceipt(terms, byOther.receipt, byOther.signature, escrowAddress.address_base), false);
        const extra = signedReceipt(1000, 1, pass, {note: 'x'});
        assert.equal(escrow.isValidReceipt(terms, extra.receipt, extra.signature, escrowAddress.address_base), false);
        const zero = signedReceipt(1000, 0);
        assert.equal(escrow.isValidReceipt(terms, zero.receipt, zero.signature, escrowAddress.address_base), false);
    });

    test('accepts receipts with a growing total and sequence, and stores them', async() => {
        const state      = authenticatedState();
        state.bytes_sent = 5000;
        assert.deepEqual(await vpnExit._onReceipt(state, signedReceipt(2000, 1)), {receipt_total_bytes: 2000, receipt_sequence: 1});
        assert.deepEqual(await vpnExit._onReceipt(state, signedReceipt(5000, 2)), {receipt_total_bytes: 5000, receipt_sequence: 2});
        assert.deepEqual(storedList.map(({receipt}) => receipt.total_bytes), [2000, 5000]);
    });

    test('refuses a receipt for more than the exit node sent', async() => {
        const state      = authenticatedState();
        state.bytes_sent = 5000;
        await assert.rejects(vpnExit._onReceipt(state, signedReceipt(5001, 1)), error => error === 'receipt_total_invalid');
    });

    test('refuses a replayed or older receipt', async() => {
        const state      = authenticatedState();
        state.bytes_sent = 5000;
        const first      = signedReceipt(3000, 1);
        await vpnExit._onReceipt(state, first);
        await assert.rejects(vpnExit._onReceipt(state, first), error => error === 'receipt_not_accepted');
        await assert.rejects(vpnExit._onReceipt(state, signedReceipt(2000, 2)), error => error === 'receipt_not_accepted');
        assert.equal(state.receipt_total_bytes, 3000);
    });

    test('refuses a receipt signed by another key or changed after signing', async() => {
        const state      = authenticatedState();
        state.bytes_sent = 5000;
        await assert.rejects(vpnExit._onReceipt(state, signedReceipt(3000, 1, other)), error => error === 'receipt_not_accepted');
        const changed               = signedReceipt(1000, 1);
        changed.receipt.total_bytes = 4000;
        await assert.rejects(vpnExit._onReceipt(state, changed), error => error === 'receipt_not_accepted');
        assert.equal(storedList.length, 0);
    });

    test('refuses a receipt before the pass is checked', async() => {
        const state         = authenticatedState();
        state.authenticated = false;
        await assert.rejects(vpnExit._onReceipt(state, signedReceipt(0, 1)), error => error === 'session_not_authenticated');
    });

    test('closes the session when the bytes sent run ahead of the receipts by more than VPN_RECEIPT_GAP_BYTES_MAX', () => {
        const state = authenticatedState();
        vpnExit._countBytesSent(state, config.VPN_RECEIPT_GAP_BYTES_MAX);
        assert.equal(state.closed, false, 'a gap of exactly the maximum is allowed');
        vpnExit._countBytesSent(state, 1);
        assert.equal(state.closed, true);
        assert.equal(state.close_reason, 'unreceipted_gap');
        assert.equal(vpnExit.sessionMap.has(state.session_id), false);
    });

    test('keeps the session open while receipts keep up', async() => {
        const state = authenticatedState();
        const step  = Math.floor(config.VPN_RECEIPT_GAP_BYTES_MAX / 2);
        for (let sequence = 1; sequence <= 6; sequence++) {
            vpnExit._countBytesSent(state, step);
            await vpnExit._onReceipt(state, signedReceipt(state.bytes_sent, sequence));
        }
        assert.equal(state.closed, false);
        assert.equal(state.receipt_total_bytes, 6 * step);
    });

    test('closes the session when the escrow\'s data is used up', () => {
        const state               = authenticatedState();
        state.bytes_sent          = state.bytes_covered - 10;
        state.receipt_total_bytes = state.bytes_covered - 10;
        vpnExit._countBytesSent(state, 10);
        assert.equal(state.close_reason, 'data_used');
    });
});

describe('receipts (user side)', () => {
    const restoreClient = [];
    after(() => restoreClient.reverse().forEach(fn => fn()));

    test('signs a receipt every VPN_RECEIPT_INTERVAL_BYTES with a running total and sequence, which the exit node accepts', async() => {
        const terms         = vpnTerms();
        const escrowAddress = escrow.getEscrowAddress(terms);
        const sentList      = [];
        stubMethod(walletEscrow, 'getPassPrivateKey', () => pass.private_key, restoreClient);
        stubMethod(vpnClient, '_request', (session, method, path, body) => {
            sentList.push({method, path, body});
            return Promise.resolve({});
        }, restoreClient);

        const clientState = {
            session            : {},
            terms,
            node_id            : exitNode.address_base,
            escrow_address_base: escrowAddress.address_base,
            bytes_received     : 0,
            receipt_total_bytes: 0,
            receipt_sequence   : 0,
            receipt_list       : [],
            closed             : false
        };
        const interval      = config.VPN_RECEIPT_INTERVAL_BYTES;
        vpnClient._countBytesReceived(clientState, interval - 1);
        assert.equal(sentList.length, 0);
        vpnClient._countBytesReceived(clientState, 1);
        vpnClient._countBytesReceived(clientState, interval + 500);
        vpnClient._sendReceipt(clientState); // a tunnel closed
        vpnClient._sendReceipt(clientState); // nothing new: no receipt
        assert.deepEqual(sentList.map(({path, body}) => [path, body.receipt.total_bytes, body.receipt.sequence]), [
            ['/vpn/receipt', interval, 1],
            ['/vpn/receipt', 2 * interval + 500, 2]
        ]);

        // the exit node accepts them
        const exitState = {
            session_id         : 'session-client',
            session            : {close: () => undefined, destroy: () => undefined, destroyed: true},
            authenticated      : true,
            escrow_record      : {...escrowAddress, terms},
            bytes_sent         : 2 * interval + 500,
            bytes_covered      : escrow.getBytesCovered(terms),
            receipt_total_bytes: 0,
            receipt_sequence   : 0,
            closed             : false
        };
        stubMethod(walletEscrow, 'addReceipt', () => Promise.resolve(true), restoreClient);
        for (const {body} of sentList) {
            await vpnExit._onReceipt(exitState, body);
        }
        assert.equal(exitState.receipt_total_bytes, 2 * interval + 500);
        assert.equal(exitState.receipt_sequence, 2);
    });

    test('the local proxy refuses plain http', async() => {
        const state = {};
        const port  = await vpnClient._startLocalProxy(state);
        try {
            const {status, body} = await new Promise((resolve, reject) => {
                http.get({host: '127.0.0.1', port, path: 'http://example.com/', agent: false}, response => {
                    let body = '';
                    response.on('data', chunk => body += chunk);
                    response.on('end', () => resolve({status: response.statusCode, body}));
                }).on('error', reject);
            });
            assert.equal(status, 403);
            assert.deepEqual(JSON.parse(body), {error: 'https_only'});
        }
        finally {
            state.local_proxy.close();
        }
    });
});

describe('pass key', () => {
    test('is derived from the wallet key and the escrow nonce, and never equals the wallet key', () => {
        const walletKey = walletUtils.generateNodeKey();
        stubMethod(wallet, 'getDefaultActiveWallet', () => 'test-wallet');
        stubMethod(wallet, 'getActiveWalletKey', () => walletKey);
        const nonce    = newNonce();
        const passKey  = walletEscrow.getPassPrivateKey(nonce);
        assert.equal(passKey.length, 32);
        assert.deepEqual(walletEscrow.getPassPrivateKey(nonce), passKey);
        assert.notDeepEqual(walletEscrow.getPassPrivateKey(newNonce()), passKey);
        assert.notDeepEqual(passKey, walletUtils.derivePrivateKey(walletKey, 0, 0));

        // the pass key signs the challenge the exit node checks against the
        // payer key in the terms
        const passPublicKey = walletEscrow.getPassPublicKey(passKey);
        const message       = objectHash.getHashBuffer({challenge: 'c', node_id: exitNode.address_base});
        assert.equal(signature.verify(message, signature.sign(message, passKey), passPublicKey), true);
    });

    test('is not available without an active wallet', () => {
        stubMethod(wallet, 'getActiveWalletKey', () => undefined);
        assert.throws(() => walletEscrow.getPassPrivateKey(newNonce()), /wallet_not_active/);
    });
});
