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
    setEscrowActivationDate,
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
const copyID        = newNonce();

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

/**
 * a storage receipt for portionCount portions proven: the receipt with the
 * file copy, the period covered and the amount earned
 */
function storageReceipt(portionCount, overrides = {}, signer = payer) {
    const body = {
        version            : config.ESCROW_RECEIPT_VERSION,
        escrow_address_base: escrowAddress.address_base,
        node_id            : payee.address_base,
        copy_id            : copyID,
        period_start       : startDate,
        period_end         : startDate + portionCount * 300,
        total_bytes        : portionCount * terms.portion_bytes,
        total_amount       : portionCount * terms.portion_amount,
        sequence           : portionCount + 1,
        receipt_date       : startDate + portionCount * 300,
        ...overrides
    };
    Object.keys(body).forEach(key => body[key] === undefined && delete body[key]);
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

let restoreRepositories, restoreActivationDate;
before(() => {
    restoreRepositories   = stubRepositories();
    restoreActivationDate = setEscrowActivationDate(0);
});
after(() => {
    restoreRepositories();
    restoreActivationDate();
});


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

    for (const [name, expected, signerList] of [
        ['signed by the payee and the wallet input owner', true, [payee, other]],
        ['without the wallet input owner signature', false, [payee]],
        ['without the payee signature', false, [other]],
        ['with an unrelated key labeled as the wallet input owner', false, [payee, {...payer, address_base: other.address_base}]]
    ]) {
        test(`${expected ? 'accepts' : 'refuses'} a mixed escrow and wallet claim ${name}`, () => {
            const transaction = spend({
                inputList: [
                    escrowInput(escrowAddress, 200000, startDate - 60, 0),
                    escrowInput(walletAddress(other), 10000, startDate - 60, 1)
                ],
                outputList: [walletOutput(109000), escrowOutput(100000)],
                signerList,
                entry: {action: 'claim', ...receipt(512000)}
            });

            // These authorization cases have valid hashes and real signatures.
            const signingTransaction = JSON.parse(JSON.stringify(transaction));
            delete signingTransaction.transaction_id;
            assert.equal(objectHash.getCHash288(signingTransaction), transaction.transaction_id);
            const signatures = signingTransaction.transaction_signature_list.map(entry => entry.signature);
            signingTransaction.transaction_signature_list.forEach(entry => delete entry.signature);
            signingTransaction.transaction_signature_list.forEach((entry, index) => {
                assert.equal(walletUtils.verify(entry.address_attribute.key_public, signatures[index], signingTransaction), true);
            });
            const payload = {...signingTransaction};
            ['payload_hash', 'transaction_date', 'node_id_origin', 'node_id_proxy', 'shard_id', 'version'].forEach(field => delete payload[field]);
            assert.equal(objectHash.getCHash288(payload), transaction.payload_hash);

            assert.equal(isValidTransaction(transaction), expected);
        });
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

describe('storage receipt', () => {
    function isValid({receipt: body, receipt_signature}, addressBase = escrowAddress.address_base, receiptTerms = terms) {
        return escrow.isValidReceipt(receiptTerms, body, receipt_signature, addressBase);
    }

    test('is valid for its escrow, its payee and the payer key, with the copy, the period and the amount its total earns', () => {
        assert.equal(isValid(storageReceipt(5)), true);
        assert.equal(escrow.isStorageReceipt(storageReceipt(5).receipt), true);
        // a first receipt, which names the copy and has earned nothing
        assert.equal(isValid(storageReceipt(0)), true);
        // all 10 portions, and a total beyond them: the amount stops at
        // the escrow's
        assert.equal(isValid(storageReceipt(10)), true);
        assert.equal(isValid(storageReceipt(11, {total_amount: terms.amount})), true);
        // half a portion more earns nothing more
        assert.equal(isValid(storageReceipt(5, {total_bytes: 5 * terms.portion_bytes + 51200})), true);
    });

    test('a receipt for data carried is still valid, and is not a storage receipt', () => {
        assert.equal(isValid(receipt(512000)), true);
        assert.equal(escrow.isStorageReceipt(receipt(512000).receipt), false);
        assert.equal(escrow.isStorageReceipt(null), false);
    });

    for (const [name, build] of [
        ['signed by another key', () => storageReceipt(5, {}, other)],
        ['signed by the payee itself', () => storageReceipt(5, {}, payee)],
        ['for another escrow', () => storageReceipt(5, {escrow_address_base: other.address_base})],
        ['for another node', () => storageReceipt(5, {node_id: other.address_base})],
        ['whose amount is more than its total earns', () => storageReceipt(5, {total_amount: 6 * terms.portion_amount})],
        ['whose amount is less than its total earns', () => storageReceipt(5, {total_amount: 4 * terms.portion_amount})],
        ['whose amount is more than the escrow', () => storageReceipt(11)],
        ['without the copy', () => storageReceipt(5, {copy_id: undefined})],
        ['without the amount', () => storageReceipt(5, {total_amount: undefined})],
        ['without the period', () => storageReceipt(5, {period_start: undefined, period_end: undefined})],
        ['with a copy id that is not 16 hex bytes', () => storageReceipt(5, {copy_id: 'copy-1'})],
        ['with a copy id that is not text', () => storageReceipt(5, {copy_id: 15601})],
        ['with a period that ends before it starts', () => storageReceipt(5, {period_end: startDate - 1})],
        ['with a period start that is not a date', () => storageReceipt(5, {period_start: 0})],
        ['with a period end that is not an integer', () => storageReceipt(5, {period_end: startDate + 0.5})],
        ['with a negative total', () => storageReceipt(5, {total_bytes: -terms.portion_bytes, total_amount: 0})],
        ['with a sequence of 0', () => storageReceipt(5, {sequence: 0})],
        ['with an extra field', () => storageReceipt(5, {note: 'x'})]
    ]) {
        test(`refuses a receipt ${name}`, () => assert.equal(isValid(build()), false));
    }

    test('refuses a receipt changed after signing', () => {
        const raised = storageReceipt(5);
        Object.assign(raised.receipt, {
            total_bytes : 10 * terms.portion_bytes,
            total_amount: 10 * terms.portion_amount
        });
        assert.equal(isValid(raised), false);
        const moved           = storageReceipt(5);
        moved.receipt.copy_id = newNonce();
        assert.equal(isValid(moved), false);
        const extended              = storageReceipt(5);
        extended.receipt.period_end += 3600;
        assert.equal(isValid(extended), false);
    });

    test('refuses a receipt under other terms', () => {
        assert.equal(isValid(storageReceipt(5), escrowAddress.address_base, {...terms, payee_public_key: other.public_key}), false);
        assert.equal(isValid(storageReceipt(5), escrowAddress.address_base, {...terms, payer_public_key: other.public_key}), false);
        // twice the price: the amount is no longer what the total earns
        assert.equal(isValid(storageReceipt(5), escrowAddress.address_base, {...terms, portion_amount: 40000, amount: 400000}), false);
    });

    describe('claim (walletUtils.isValidTransactionObject)', () => {
        for (const [name, expected, build] of [
            ['payee signs, 5 proven portions, rest back to the escrow', true,
                () => spend({outputList: [walletOutput(99000), escrowOutput(100000)], signerList: [payee], entry: {action: 'claim', ...storageReceipt(5)}})],
            ['all 10 portions proven, nothing back to the escrow', true,
                () => spend({outputList: [walletOutput(199000)], signerList: [payee], entry: {action: 'claim', ...storageReceipt(10)}})],
            ['takes 1 portion more than the receipt', false,
                () => spend({outputList: [walletOutput(119000), escrowOutput(80000)], signerList: [payee], entry: {action: 'claim', ...storageReceipt(5)}})],
            ['the first receipt, which earned nothing, takes a portion', false,
                () => spend({outputList: [walletOutput(19000), escrowOutput(180000)], signerList: [payee], entry: {action: 'claim', ...storageReceipt(0)}})],
            ['a receipt whose period moved on while its amount did not takes the portions of that time', false,
                () => spend({outputList: [walletOutput(159000), escrowOutput(40000)], signerList: [payee], entry: {action: 'claim', ...storageReceipt(5, {period_end: startDate + 8 * 300, sequence: 9})}})],
            ['receipt amount raised above what its total earns', false,
                () => spend({outputList: [walletOutput(199000)], signerList: [payee], entry: {action: 'claim', ...storageReceipt(5, {total_amount: 200000})}})],
            ['receipt signed by the payee itself', false,
                () => spend({outputList: [walletOutput(99000), escrowOutput(100000)], signerList: [payee], entry: {action: 'claim', ...storageReceipt(5, {}, payee)}})],
            ['receipt for another escrow', false,
                () => spend({outputList: [walletOutput(99000), escrowOutput(100000)], signerList: [payee], entry: {action: 'claim', ...storageReceipt(5, {escrow_address_base: other.address_base})}})],
            ['signed by a third key, not the payee', false,
                () => spend({outputList: [walletOutput(99000), escrowOutput(100000)], signerList: [other], entry: {action: 'claim', ...storageReceipt(5)}})],
            ['returns the rest to a wallet address instead of the escrow', false,
                () => spend({outputList: [walletOutput(99000), walletOutput(100000, payerWallet)], signerList: [payee], entry: {action: 'claim', ...storageReceipt(5)}})]
        ]) {
            test(`${expected ? 'accepts' : 'refuses'} a claim: ${name}`, () => assert.equal(isValidTransaction(build()), expected));
        }
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
