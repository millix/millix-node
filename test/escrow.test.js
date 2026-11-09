import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import config from '../core/config/config';
import network from '../net/network';
import wallet from '../core/wallet/wallet';
import walletUtils from '../core/wallet/wallet-utils';
import objectHash from '../core/crypto/object-hash';
import escrow from '../core/wallet/escrow';
import walletEscrow from '../core/wallet/wallet-escrow';
import {
    buildTransaction,
    escrowInput,
    isValidTransaction,
    newKey,
    newNonce,
    now,
    stubRepositories,
    VERSION,
    walletAddress
} from './helper';

const payer       = newKey();
const payee       = newKey();
const other       = newKey();
const payeeWallet = newKey();
const payerWallet = newKey();
const startDate   = now();

// 10 portions of 100 KB at 20,000 millix each
const terms         = {
    version         : config.ESCROW_TERMS_VERSION,
    payer_public_key: payer.public_key,
    payee_public_key: payee.public_key,
    amount          : 200000,
    portion_bytes   : 102400,
    portion_amount  : 20000,
    unlock_date     : startDate + 600,
    nonce           : newNonce()
};
const escrowAddress = escrow.getEscrowAddress(terms);

function receipt(totalBytes, signer = payer, overrides = {}) {
    const body = {
        version            : config.ESCROW_RECEIPT_VERSION,
        escrow_address_base: escrowAddress.address_base,
        node_id            : payee.address_base,
        total_bytes        : totalBytes,
        sequence           : 3,
        receipt_date       : startDate,
        ...overrides
    };
    return {
        receipt          : body,
        receipt_signature: escrow.signReceipt(body, signer.private_key)
    };
}

function escrowOutput(amount) {
    return {
        address_base          : escrowAddress.address_base,
        address_version       : escrowAddress.address_version,
        address_key_identifier: escrowAddress.address_key_identifier,
        amount
    };
}

function walletOutput(amount, key = payeeWallet) {
    return {
        ...walletAddress(key),
        amount
    };
}

function spend({outputList, signerList, entry, version, transactionDate = startDate, entryTerms = terms, inputList}) {
    return buildTransaction({
        inputList : inputList || [escrowInput(escrowAddress, 200000)],
        outputList,
        signerList,
        version,
        transactionDate,
        metadata  : entry ? {
            escrow: [
                {
                    address_base: escrowAddress.address_base,
                    terms       : entryTerms,
                    ...entry
                }
            ]
        } : undefined
    });
}

let restoreRepositories;
before(() => restoreRepositories = stubRepositories());
after(() => restoreRepositories());


describe('escrow address', () => {
    test('is derived from the hash of the terms, with the escrow address version', () => {
        assert.equal(escrowAddress.address_base, walletUtils.getAddressFromPublicKey(objectHash.getHashBuffer(terms)));
        assert.ok(walletUtils.isValidAddress(escrowAddress.address_base));
        assert.equal(escrowAddress.address_version, config.ADDRESS_VERSION_ESCROW);
        assert.equal(escrowAddress.address_key_identifier, escrowAddress.address_base);
        assert.equal(escrowAddress.address, `${escrowAddress.address_base}${config.ADDRESS_VERSION_ESCROW}${escrowAddress.address_base}`);
        assert.ok(escrow.isEscrowAddressVersion(escrowAddress.address_version));
        assert.ok(!escrow.isEscrowAddressVersion(VERSION.address_wallet));
    });

    test('is the same for the same terms, whatever the key order', () => {
        const reordered = {};
        Object.keys(terms).reverse().forEach(key => reordered[key] = terms[key]);
        assert.deepEqual(escrow.getEscrowAddress({...terms}), escrowAddress);
        assert.deepEqual(escrow.getEscrowAddress(reordered), escrowAddress);
    });

    for (const [field, value] of [
        ['payer_public_key', other.public_key],
        ['payee_public_key', other.public_key],
        ['amount', 200001],
        ['portion_bytes', 102401],
        ['portion_amount', 20001],
        ['unlock_date', startDate + 601],
        ['nonce', newNonce()]
    ]) {
        test(`changes when ${field} changes`, () => {
            assert.notEqual(escrow.getAddressBaseFromTerms({
                ...terms,
                [field]: value
            }), escrowAddress.address_base);
        });
    }
});

describe('escrow terms', () => {
    test('accepts well formed terms', () => assert.ok(escrow.isValidTerms(terms)));

    for (const [name, change] of [
        ['the payer and payee are the same key', {payee_public_key: payer.public_key}],
        ['a public key is not a key', {payer_public_key: 'not-a-key'}],
        ['the amount is not a positive integer', {amount: 1.5}],
        ['a portion is smaller than ESCROW_PORTION_BYTES_MIN', {portion_bytes: config.ESCROW_PORTION_BYTES_MIN - 1}],
        ['a portion costs more than the amount', {portion_amount: 200001}],
        ['the unlock date is missing', {unlock_date: undefined}],
        ['the nonce is not 16 hex bytes', {nonce: 'abc'}],
        ['the version is unknown', {version: config.ESCROW_TERMS_VERSION + 1}],
        ['there is an extra field', {note: 'x'}]
    ]) {
        test(`refuses terms where ${name}`, () => {
            const changed = {...terms, ...change};
            Object.keys(changed).forEach(key => changed[key] === undefined && delete changed[key]);
            assert.equal(escrow.isValidTerms(changed), false);
        });
    }

    test('earns whole portions only, never more than the amount', () => {
        assert.equal(escrow.getEarnedAmount(terms, 0), 0);
        assert.equal(escrow.getEarnedAmount(terms, 102399), 0);
        assert.equal(escrow.getEarnedAmount(terms, 102400), 20000);
        assert.equal(escrow.getEarnedAmount(terms, 512000), 100000);
        assert.equal(escrow.getEarnedAmount(terms, 10 * 1024 * 1024 * 1024), 200000);
        assert.equal(escrow.getBytesCovered(terms), 1024000);
    });
});

describe('escrow spend rules (walletUtils.isValidTransactionObject)', () => {
    const cases = [
        // [name, expected valid, transaction]
        ['claim: payee signs, 5 receipted portions, rest back to the escrow', true,
            () => spend({outputList: [walletOutput(99000), escrowOutput(100000)], signerList: [payee], entry: {action: 'claim', ...receipt(512000)}})],
        ['claim: all 10 portions receipted, nothing back to the escrow', true,
            () => spend({outputList: [walletOutput(199000)], signerList: [payee], entry: {action: 'claim', ...receipt(1024000)}})],
        ['claim: takes 1 portion more than receipted', false,
            () => spend({outputList: [walletOutput(119000), escrowOutput(80000)], signerList: [payee], entry: {action: 'claim', ...receipt(512000)}})],
        ['claim: returns the rest to a wallet address instead of the escrow', false,
            () => spend({outputList: [walletOutput(99000), walletOutput(100000, payerWallet)], signerList: [payee], entry: {action: 'claim', ...receipt(512000)}})],
        ['claim: receipt signed by another key', false,
            () => spend({outputList: [walletOutput(99000), escrowOutput(100000)], signerList: [payee], entry: {action: 'claim', ...receipt(512000, other)}})],
        ['claim: receipt signed by the payee itself', false,
            () => spend({outputList: [walletOutput(99000), escrowOutput(100000)], signerList: [payee], entry: {action: 'claim', ...receipt(512000, payee)}})],
        ['claim: receipt for another escrow', false,
            () => spend({outputList: [walletOutput(99000), escrowOutput(100000)], signerList: [payee], entry: {action: 'claim', ...receipt(512000, payer, {escrow_address_base: other.address_base})}})],
        ['claim: receipt for another node', false,
            () => spend({outputList: [walletOutput(99000), escrowOutput(100000)], signerList: [payee], entry: {action: 'claim', ...receipt(512000, payer, {node_id: other.address_base})}})],
        ['claim: no receipt', false,
            () => spend({outputList: [walletOutput(99000), escrowOutput(100000)], signerList: [payee], entry: {action: 'claim'}})],
        ['claim: signed by a third key, not the payee', false,
            () => spend({outputList: [walletOutput(99000), escrowOutput(100000)], signerList: [other], entry: {action: 'claim', ...receipt(512000)}})],
        ['claim: payee key listed under another address (signer address not derived from its key)', false,
            () => spend({outputList: [walletOutput(99000), escrowOutput(100000)], signerList: [{...payee, address_base: escrowAddress.address_base}], entry: {action: 'claim', ...receipt(512000)}})],
        ['claim: receipt total raised after the payer signed it', false,
            () => {
                const entry                = receipt(102400);
                entry.receipt.total_bytes = 1024000;
                return spend({outputList: [walletOutput(199000)], signerList: [payee], entry: {action: 'claim', ...entry}});
            }],
        ['claim: escrow metadata changed after the transaction was signed', false,
            () => {
                const transaction                                                                         = spend({outputList: [walletOutput(99000), escrowOutput(100000)], signerList: [payee], entry: {action: 'claim', ...receipt(512000)}});
                transaction.transaction_output_attribute.transaction_output_metadata.escrow[0].action = 'close';
                return transaction;
            }],
        ['claim: terms changed (more per portion), address no longer matches', false,
            () => spend({outputList: [walletOutput(199000)], signerList: [payee], entryTerms: {...terms, portion_amount: 200000}, entry: {action: 'claim', ...receipt(512000)}})],
        ['claim: no escrow metadata', false,
            () => spend({outputList: [walletOutput(199000)], signerList: [payee]})],
        ['claim: two escrow entries for one escrow input', false,
            () => {
                const entry = {address_base: escrowAddress.address_base, terms, action: 'claim', ...receipt(512000)};
                return buildTransaction({
                    inputList : [escrowInput(escrowAddress, 200000)],
                    outputList: [walletOutput(99000), escrowOutput(100000)],
                    signerList: [payee],
                    metadata  : {escrow: [entry, entry]}
                });
            }],
        [`claim: version ${VERSION.transaction} (output metadata not signed)`, false,
            () => spend({outputList: [walletOutput(99000), escrowOutput(100000)], signerList: [payee], version: VERSION.transaction, entry: {action: 'claim', ...receipt(512000)}})],
        [`spend in a refresh transaction ${VERSION.transaction_refresh}`, false,
            () => spend({outputList: [escrowOutput(199000)], signerList: [payee], version: VERSION.transaction_refresh, entry: {action: 'claim', ...receipt(512000)}})],
        ['refund: payer signs at the unlock date', true,
            () => spend({outputList: [walletOutput(199000, payerWallet)], signerList: [payer], transactionDate: terms.unlock_date, entry: {action: 'refund'}})],
        ['refund: payer signs one second before the unlock date', false,
            () => spend({outputList: [walletOutput(199000, payerWallet)], signerList: [payer], transactionDate: terms.unlock_date - 1, entry: {action: 'refund'}})],
        ['refund: payee signs after the unlock date', false,
            () => spend({outputList: [walletOutput(199000)], signerList: [payee], transactionDate: terms.unlock_date, entry: {action: 'refund'}})],
        ['refund: a third key signs after the unlock date', false,
            () => spend({outputList: [walletOutput(199000)], signerList: [other], transactionDate: terms.unlock_date, entry: {action: 'refund'}})],
        ['close: payer and payee sign, any outputs', true,
            () => spend({outputList: [walletOutput(199000)], signerList: [payer, payee], entry: {action: 'close'}})],
        ['close: payer alone', false,
            () => spend({outputList: [walletOutput(199000)], signerList: [payer], entry: {action: 'close'}})],
        ['close: payee alone', false,
            () => spend({outputList: [walletOutput(199000)], signerList: [payee], entry: {action: 'close'}})],
        ['unknown action', false,
            () => spend({outputList: [walletOutput(199000)], signerList: [payer, payee], entry: {action: 'take'}})]
    ];

    for (const [name, expected, build] of cases) {
        test(`${expected ? 'accepts' : 'refuses'} ${name}`, () => assert.equal(isValidTransaction(build()), expected));
    }

    test('a transaction without escrow inputs is not affected', () => {
        const key         = newKey();
        const transaction = buildTransaction({
            // an unspent output of a wallet address
            inputList : [escrowInput(walletAddress(key), 200000)],
            outputList: [walletOutput(199000)],
            signerList: [key],
            version   : VERSION.transaction
        });
        assert.equal(isValidTransaction(transaction), true);
    });

    test('escrow outputs do not expire; wallet outputs older than 10 minutes do', async() => {
        const weekAgo           = now() - 7 * 24 * 3600;
        const maximumOldestDate = now() - config.TRANSACTION_OUTPUT_EXPIRE_OLDER_THAN * 60;
        assert.ok(!await walletUtils.isConsumingExpiredOutputs([escrowInput(escrowAddress, 1, weekAgo)], maximumOldestDate));
        assert.equal(await walletUtils.isConsumingExpiredOutputs([escrowInput(walletAddress(other), 1, weekAgo)], maximumOldestDate), true);
    });
});

describe('escrow claim and refund (wallet-escrow)', () => {
    let restore = [];
    let sent;

    function stubMethod(object, name, value) {
        const original = object[name];
        object[name]   = value;
        restore.push(() => object[name] = original);
    }

    function useEscrowRecord(escrowRecord, inputList) {
        restoreRepositories();
        restoreRepositories = stubRepositories({
            escrow: {
                getEscrow   : addressBase => Promise.resolve(addressBase === escrowRecord.address_base ? escrowRecord : null),
                updateStatus: () => Promise.resolve()
            }
        });
        stubMethod(walletEscrow, 'getEscrowInputList', () => Promise.resolve(inputList));
    }

    before(() => {
        stubMethod(network, 'nodeID', payee.address_base);
        stubMethod(network, 'nodePublicKey', payee.public_key);
        stubMethod(network, 'nodePrivateKey', payee.node_private_key);
        stubMethod(wallet, 'defaultKeyIdentifier', payeeWallet.address_base);
        stubMethod(walletEscrow, '_sendEscrowTransaction', (inputList, outputList, signer, escrowEntry) => {
            sent = {inputList, outputList, signer, escrowEntry};
            return Promise.resolve({transaction_id: 'T'.repeat(50)});
        });
    });
    after(() => restore.reverse().forEach(fn => fn()));

    function payeeRecord(totalBytes) {
        const {receipt: body, receipt_signature} = receipt(totalBytes);
        return {
            address_base       : escrowAddress.address_base,
            role               : 'payee',
            terms,
            receipt            : body,
            receipt_signature,
            receipt_total_bytes: totalBytes
        };
    }

    test('the payee claims what the latest receipt earned and returns the rest to the escrow', async() => {
        useEscrowRecord(payeeRecord(153321), [escrowInput(escrowAddress, 200000)]);
        const result = await walletEscrow.claim(escrowAddress.address_base);
        assert.equal(result.amount_claimed, 20000);
        assert.equal(result.amount_returned, 180000);
        assert.deepEqual(sent.outputList, [
            walletOutput(20000 - config.TRANSACTION_FEE_PROXY),
            escrowOutput(180000)
        ]);
        assert.equal(sent.signer.public_key, payee.public_key);
        assert.equal(sent.escrowEntry.action, 'claim');

        // every node accepts the claim it builds
        const transaction = buildTransaction({
            inputList : sent.inputList,
            outputList: sent.outputList,
            signerList: [sent.signer],
            metadata  : {escrow: [sent.escrowEntry]}
        });
        assert.equal(isValidTransaction(transaction), true);
    });

    test('a second claim takes only what the newer receipt added', async() => {
        useEscrowRecord(payeeRecord(512000), [escrowInput(escrowAddress, 180000)]);
        const result = await walletEscrow.claim(escrowAddress.address_base);
        assert.equal(result.amount_claimed, 80000);
        assert.equal(result.amount_returned, 100000);
    });

    test('the payee cannot claim less than the fee', async() => {
        useEscrowRecord(payeeRecord(102399), [escrowInput(escrowAddress, 200000)]);
        await assert.rejects(walletEscrow.claim(escrowAddress.address_base), error => error === 'escrow_claim_amount_too_small');
    });

    test('the payer cannot claim', async() => {
        useEscrowRecord({...payeeRecord(512000), role: 'payer'}, [escrowInput(escrowAddress, 200000)]);
        await assert.rejects(walletEscrow.claim(escrowAddress.address_base), error => error === 'escrow_not_found');
    });

    test('a refund before the unlock date is refused', async() => {
        useEscrowRecord({address_base: escrowAddress.address_base, role: 'payer', terms: {...terms, unlock_date: now() + 3600}}, [escrowInput(escrowAddress, 180000)]);
        await assert.rejects(walletEscrow.refund(escrowAddress.address_base), error => error === 'escrow_locked');
    });

    test('after the unlock date the payer gets back what is left, signed by the pass key', async() => {
        const unlockedTerms   = {...terms, unlock_date: now() - 1};
        const unlockedAddress = escrow.getEscrowAddress(unlockedTerms);
        useEscrowRecord({address_base: unlockedAddress.address_base, role: 'payer', terms: unlockedTerms}, [escrowInput(unlockedAddress, 180000)]);
        stubMethod(walletEscrow, 'getPassPrivateKey', () => payer.private_key);
        stubMethod(wallet, 'defaultKeyIdentifier', payerWallet.address_base);

        await walletEscrow.refund(unlockedAddress.address_base);
        assert.deepEqual(sent.outputList, [walletOutput(180000 - config.TRANSACTION_FEE_PROXY, payerWallet)]);
        assert.equal(sent.signer.public_key, payer.public_key);
        assert.equal(sent.escrowEntry.action, 'refund');

        const transaction = buildTransaction({
            inputList : sent.inputList,
            outputList: sent.outputList,
            signerList: [sent.signer],
            metadata  : {escrow: [sent.escrowEntry]}
        });
        assert.equal(isValidTransaction(transaction), true);
    });
});
