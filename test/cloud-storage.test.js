import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import config from '../core/config/config';
import network from '../net/network';
import wallet from '../core/wallet/wallet';
import walletUtils from '../core/wallet/wallet-utils';
import objectHash from '../core/crypto/object-hash';
import escrow from '../core/wallet/escrow';
import walletEscrow from '../core/wallet/wallet-escrow';
import cloudStorage from '../net/cloud-storage';
import {CLOUD_OFFER_VERSION} from '../net/cloud-offer';
import EscrowRepository from '../database/repositories/escrow';
import {
    buildTransaction,
    escrowInput,
    fullAddress,
    isValidTransaction,
    newKey,
    newNonce,
    now,
    openCloudDatabase,
    setEscrowActivationDate,
    stubRepositories,
    walletAddress
} from './helper';

const host         = newKey();
const hostWallet   = newKey();
const renterPass   = newKey();
const renterWallet = newKey();
const broker       = newKey();
const other        = newKey();

const INTERVAL  = config.CLOUD_STORAGE_PROOF_INTERVAL;
const FEE       = config.TRANSACTION_FEE_PROXY;
// a copy of 2 GB at 6,000 millix for a GB an hour: 1,000 millix for each
// proof interval of 5 minutes, 12,000 for an hour
const SIZE      = 2 * config.CLOUD_STORAGE_GB_BYTES;
const PRICE     = 6000;
const PORTION   = 1000;
const PERIOD    = 3600;
const startDate = now();

function signOffer(body, key = host) {
    return {
        ...body,
        offer_id : objectHash.getCHash288(body),
        signature: walletUtils.signMessage(key.node_private_key, body)
    };
}

/**
 * the signed storage host offer of the host node. storage null: the offer
 * of an older node, which names the node only.
 */
function storageOffer(storage = {}, overrides = {}) {
    const body = {
        version          : CLOUD_OFFER_VERSION,
        node_id          : host.address_base,
        node_public_key  : host.public_key,
        service          : 'storage_host',
        location         : {country: 'US'},
        upload_speed_kbps: 50000,
        endpoint         : {
            node_prefix  : 'wss://',
            node_address : '203.0.113.7',
            node_port    : config.NODE_PORT,
            node_port_api: config.NODE_PORT_API
        },
        broker_list      : [
            {
                address   : fullAddress(broker),
                public_key: broker.public_key
            }
        ],
        create_date      : startDate,
        end_date         : startDate + 24 * 3600,
        ...overrides
    };
    if (storage) {
        body.endpoint = {
            ...body.endpoint,
            service_port: 15601
        };
        body.storage  = {
            price_gb_hour    : PRICE,
            price_fetch_gb   : 5000,
            address          : fullAddress(hostWallet),
            free_gb          : 250,
            accept_new       : true,
            rental_period_min: PERIOD,
            ...storage
        };
    }
    return signOffer(body);
}

function newCopyID() {
    return newNonce();
}

const restore = [];

function stubMethod(object, name, value) {
    const original = object[name];
    object[name]   = value;
    restore.push(() => object[name] = original);
}

// the renter's node and the host's node each have their own escrow table
// (the real repository on the table of migration 25). asRenter and asHost
// switch which node the code under test runs on.
let renterRepository, hostRepository, escrowRepository;
// one clock for the storage and the escrow code
let clock            = startDate;
// offers by id, as the renter's node knows them
const offerMap       = new Map();
// what is locked at each escrow address base, as both nodes see it
const lockedMap      = new Map();
const fundingList    = [];
const requestedList  = [];
let sent;

function asRenter() {
    escrowRepository            = renterRepository;
    wallet.defaultKeyIdentifier = renterWallet.address_base;
}

function asHost() {
    escrowRepository            = hostRepository;
    wallet.defaultKeyIdentifier = hostWallet.address_base;
}

function addOffer(offer) {
    offerMap.set(offer.offer_id, offer);
    return offer;
}

const offer = addOffer(storageOffer());

before(async() => {
    renterRepository = new EscrowRepository(await openCloudDatabase([25]));
    hostRepository   = new EscrowRepository(await openCloudDatabase([25]));
    restore.push(stubRepositories({
        escrow     : new Proxy({}, {get: (_, name) => (...args) => escrowRepository[name](...args)}),
        cloud_offer: {getOfferByID: offerID => Promise.resolve(offerMap.get(offerID))}
    }));
    restore.push(setEscrowActivationDate(0));
    stubMethod(cloudStorage, '_now', () => clock);
    stubMethod(walletEscrow, '_now', () => clock);
    stubMethod(network, 'nodeID', host.address_base);
    stubMethod(network, 'nodePublicKey', host.public_key);
    stubMethod(network, 'nodePrivateKey', host.node_private_key);
    stubMethod(wallet, 'defaultKeyIdentifier', renterWallet.address_base);
    // the renter's pass key, which the node derives from its wallet key
    stubMethod(walletEscrow, 'getPassPrivateKey', () => renterPass.private_key);
    // no transaction leaves the test: funding an escrow records what was
    // locked, a claim or a refund records what would be sent
    stubMethod(wallet, 'addTransaction', outputList => {
        fundingList.push(outputList);
        outputList.forEach(output => lockedMap.set(output.address_base, output.amount));
        return Promise.resolve([{transaction_id: 'F'.repeat(50)}]);
    });
    stubMethod(walletEscrow, 'getEscrowInputList', terms => {
        const escrowAddress = escrow.getEscrowAddress(terms);
        const amount        = lockedMap.get(escrowAddress.address_base) || 0;
        return Promise.resolve(amount > 0 ? [escrowInput(escrowAddress, amount)] : []);
    });
    stubMethod(walletEscrow, 'requestFundingTransaction', transactionID => requestedList.push(transactionID));
    stubMethod(walletEscrow, '_sendEscrowTransaction', (inputList, outputList, signer, escrowEntry) => {
        sent = {inputList, outputList, signer, escrowEntry};
        return Promise.resolve({transaction_id: 'T'.repeat(50)});
    });
});
after(() => restore.reverse().forEach(fn => fn()));

/**
 * the renter opens a rental at the clock's date and the host takes its
 * first receipt
 */
async function openRental(copyID = newCopyID(), period = PERIOD) {
    asRenter();
    const rental = await cloudStorage.openRental(offer.offer_id, copyID, SIZE, period);
    asHost();
    await cloudStorage.addReceipt(rental.terms, rental.receipt, rental.receipt_signature, rental.funding_transaction_id);
    return rental;
}

/**
 * a proof at the clock's date: the renter signs its receipt
 */
function sign(rental, passed = true) {
    asRenter();
    return cloudStorage.signReceipt(rental.escrow_address_base, passed);
}

/**
 * a proof at the clock's date: the renter signs its receipt and the host
 * takes it
 * @return {Promise<{receipt, receipt_signature}>}
 */
async function proof(rental, passed = true) {
    const signed = await sign(rental, passed);
    asHost();
    await cloudStorage.addReceipt(rental.terms, signed.receipt, signed.receipt_signature);
    return signed;
}

/**
 * a receipt signed outside the node, as a forger or a changed renter would
 */
function signedReceipt(receipt, overrides = {}, key = renterPass) {
    const body = {
        ...receipt,
        ...overrides
    };
    return {
        receipt  : body,
        signature: escrow.signReceipt(body, key.private_key)
    };
}

function escrowOutput(terms, amount) {
    const escrowAddress = escrow.getEscrowAddress(terms);
    return {
        address_base          : escrowAddress.address_base,
        address_version       : escrowAddress.address_version,
        address_key_identifier: escrowAddress.address_key_identifier,
        amount
    };
}

function walletOutput(amount, key = hostWallet) {
    return {
        ...walletAddress(key),
        amount
    };
}

/**
 * the transaction wallet-escrow would send, signed as the node signs it
 */
function sentTransaction(transactionDate = clock) {
    return buildTransaction({
        inputList : sent.inputList,
        outputList: sent.outputList,
        signerList: [sent.signer],
        metadata  : {escrow: [sent.escrowEntry]},
        transactionDate
    });
}


describe('storage rent', () => {
    for (const [sizeBytes, priceGbHour, expected] of [
        [SIZE, PRICE, PORTION],
        [config.CLOUD_STORAGE_GB_BYTES, 120, 10],
        // 4.17 millix, rounded up
        [config.CLOUD_STORAGE_GB_BYTES / 2, 100, 5],
        // a copy of one byte still pays a millix for each proof interval
        [1, 1, 1],
        // 1,000 GB at 1,000,000 millix: beyond what a double multiplies
        // exactly
        [1000 * config.CLOUD_STORAGE_GB_BYTES, 1000000, 83333334]
    ]) {
        test(`a copy of ${sizeBytes} bytes at ${priceGbHour} millix for a GB an hour pays ${expected} millix for each proof interval`, () => {
            assert.equal(cloudStorage.getPortionAmount(sizeBytes, priceGbHour), expected);
        });
    }
});

describe('opening a rental (renter)', () => {
    test('locks the rent of the period for the host and signs a first receipt that names the copy and earned nothing', async() => {
        asRenter();
        clock                = startDate;
        const copyID         = newCopyID();
        const fundingCount   = fundingList.length;
        const rental         = await cloudStorage.openRental(offer.offer_id, copyID, SIZE, PERIOD);
        const escrowAddress  = escrow.getEscrowAddress(rental.terms);

        // the escrow the vpn uses, with a proof interval as its portion
        assert.equal(escrow.isValidTerms(rental.terms), true);
        assert.equal(rental.terms.payee_public_key, host.public_key);
        assert.equal(rental.terms.payer_public_key, renterPass.public_key);
        assert.equal(rental.terms.portion_bytes, config.CLOUD_STORAGE_PROOF_BYTES);
        assert.equal(rental.terms.portion_amount, PORTION);
        assert.equal(rental.terms.amount, 12 * PORTION);
        assert.equal(rental.terms.unlock_date, startDate + PERIOD + config.CLOUD_STORAGE_ESCROW_UNLOCK_AFTER);
        assert.equal(rental.escrow_address, escrowAddress.address);
        assert.equal(rental.period_start, startDate);
        assert.equal(rental.period_end, startDate + PERIOD);
        assert.equal(rental.proof_interval, INTERVAL);

        // one funding transaction, of the rent, to the escrow address
        assert.equal(fundingList.length, fundingCount + 1);
        assert.deepEqual(fundingList.at(-1), [
            {
                address_base          : escrowAddress.address_base,
                address_version       : config.ADDRESS_VERSION_ESCROW,
                address_key_identifier: escrowAddress.address_base,
                amount                : 12 * PORTION
            }
        ]);
        assert.equal(rental.funding_transaction_id, 'F'.repeat(50));

        assert.deepEqual(rental.receipt, {
            version            : config.ESCROW_RECEIPT_VERSION,
            escrow_address_base: escrowAddress.address_base,
            node_id            : host.address_base,
            copy_id            : copyID,
            period_start       : startDate,
            period_end         : startDate,
            total_bytes        : 0,
            total_amount       : 0,
            sequence           : 1,
            receipt_date       : startDate
        });
        assert.equal(escrow.isValidReceipt(rental.terms, rental.receipt, rental.receipt_signature, escrowAddress.address_base), true);

        const escrowRecord = await renterRepository.getEscrow(escrowAddress.address_base);
        assert.equal(escrowRecord.role, 'payer');
        assert.equal(escrowRecord.node_id, host.address_base);
        assert.deepEqual(escrowRecord.receipt, rental.receipt);
        assert.equal(escrowRecord.funding_transaction_id, 'F'.repeat(50));
    });

    test('a period that is not whole proof intervals pays the interval it ends in', async() => {
        asRenter();
        clock        = startDate;
        const rental = await cloudStorage.openRental(offer.offer_id, newCopyID(), SIZE, PERIOD + 1);
        assert.equal(rental.terms.amount, 13 * PORTION);
        assert.equal(rental.period_end, startDate + 13 * INTERVAL);
    });

    for (const [name, build, reason] of [
        ['an offer it does not know', () => ['X'.repeat(50), newCopyID(), SIZE, PERIOD], 'offer_not_found'],
        ['the offer of an older node, which names the node only', () => [addOffer(storageOffer(null)).offer_id, newCopyID(), SIZE, PERIOD], 'offer_node_only'],
        ['an offer of another service', () => [addOffer(storageOffer(null, {service: 'vpn_forward', endpoint: {...storageOffer(null).endpoint, service_port: config.NODE_PORT_FORWARD}})).offer_id, newCopyID(), SIZE, PERIOD], 'offer_not_storage_host'],
        ['an offer whose price was changed after signing', () => {
            const changed                 = storageOffer({price_gb_hour: PRICE + 1});
            changed.storage.price_gb_hour = 1;
            return [addOffer(changed).offer_id, newCopyID(), SIZE, PERIOD];
        }, 'offer_invalid_id'],
        ['a period shorter than the host\'s minimum', () => [offer.offer_id, newCopyID(), SIZE, PERIOD - 1], 'storage_period_too_short'],
        ['a period the escrow cannot stay locked for', () => [offer.offer_id, newCopyID(), SIZE, config.ESCROW_UNLOCK_DURATION_MAX], 'storage_period_too_long'],
        ['a rent the host could not claim: not more than the fee', () => [offer.offer_id, newCopyID(), 1024, PERIOD], 'storage_rent_below_fee'],
        ['a copy id that is not 16 hex bytes', () => [offer.offer_id, 'copy-1', SIZE, PERIOD], 'storage_copy_id_invalid'],
        ['a size that is not a positive integer', () => [offer.offer_id, newCopyID(), 0.5, PERIOD], 'storage_size_invalid'],
        ['a period that is not a positive integer', () => [offer.offer_id, newCopyID(), SIZE, 0], 'storage_period_invalid']
    ]) {
        test(`refuses ${name}, and funds nothing`, async() => {
            asRenter();
            clock              = startDate;
            const fundingCount = fundingList.length;
            await assert.rejects(cloudStorage.openRental(...build()), error => error === reason);
            assert.equal(fundingList.length, fundingCount);
        });
    }
});

describe('a rental paid by its proofs', () => {
    let rental, addressBase, latest;
    // every receipt of the rental with its signature, the first one first
    const signedList = [];

    async function nextProof(passed = true) {
        const signed = await proof(rental, passed);
        signedList.push(signed);
        return signed.receipt;
    }

    // a proof runs a little after the end of proof interval index
    const at = (index, late = 20) => clock = startDate + index * INTERVAL + late;

    before(async() => {
        clock       = startDate;
        asRenter();
        rental      = await cloudStorage.openRental(offer.offer_id, newCopyID(), SIZE, PERIOD);
        addressBase = rental.escrow_address_base;
        signedList.push(rental);
    });

    test('the host records the funded escrow from its terms and the first receipt', async() => {
        asHost();
        assert.equal(await hostRepository.getEscrow(addressBase), undefined);
        const result = await cloudStorage.addReceipt(rental.terms, rental.receipt, rental.receipt_signature, rental.funding_transaction_id);
        assert.deepEqual(result, {
            escrow_address     : rental.escrow_address,
            escrow_address_base: addressBase,
            copy_id            : rental.copy_id,
            period_start       : startDate,
            period_end         : startDate,
            receipt_sequence   : 1,
            receipt_total_bytes: 0,
            amount             : 12 * PORTION,
            portion_amount     : PORTION,
            amount_earned      : 0,
            unlock_date        : rental.terms.unlock_date
        });

        const escrowRecord = await hostRepository.getEscrow(addressBase);
        assert.equal(escrowRecord.role, 'payee');
        assert.deepEqual(escrowRecord.terms, rental.terms);
        assert.deepEqual(escrowRecord.receipt, rental.receipt);
        assert.equal(escrowRecord.funding_transaction_id, rental.funding_transaction_id);
    });

    test('the first receipt claims nothing', async() => {
        asHost();
        await assert.rejects(walletEscrow.claim(addressBase), error => error === 'escrow_claim_amount_too_small');
    });

    test('a proof before the first proof interval ended earns nothing and signs nothing', async() => {
        at(0, 30);
        await assert.rejects(sign(rental), error => error === 'storage_receipt_not_due');
        assert.equal((await renterRepository.getEscrow(addressBase)).receipt_sequence, 1);
    });

    test('each passed proof adds a portion: the receipts carry a running total, and the host keeps the latest', async() => {
        for (let index = 1; index <= 4; index++) {
            at(index);
            latest = await nextProof();
            assert.deepEqual(latest, {
                ...rental.receipt,
                period_end  : clock,
                total_bytes : index * config.CLOUD_STORAGE_PROOF_BYTES,
                total_amount: index * PORTION,
                sequence    : index + 1,
                receipt_date: clock
            });
        }

        const escrowRecord = await hostRepository.getEscrow(addressBase);
        assert.deepEqual(escrowRecord.receipt, latest);
        assert.equal(escrowRecord.receipt_sequence, 5);
        assert.equal(escrowRecord.receipt_total_bytes, 4 * config.CLOUD_STORAGE_PROOF_BYTES);

        asHost();
        const status = await walletEscrow.getEscrowStatus(addressBase);
        assert.equal(status.amount_locked, 12 * PORTION);
        assert.equal(status.amount_earned, 4 * PORTION);
        assert.equal(status.amount_claimable, 4 * PORTION);
    });

    test('a second proof in the same proof interval is not due', async() => {
        at(4, 200);
        await assert.rejects(sign(rental), error => error === 'storage_receipt_not_due');
        await assert.rejects(sign(rental, false), error => error === 'storage_receipt_not_due');
    });

    test('a stretch of missed proofs earns nothing: its receipts move the period on and leave the amount', async() => {
        for (let index = 5; index <= 7; index++) {
            at(index);
            latest = await nextProof(false);
            assert.equal(latest.total_amount, 4 * PORTION);
            assert.equal(latest.total_bytes, 4 * config.CLOUD_STORAGE_PROOF_BYTES);
            assert.equal(latest.period_end, clock);
            assert.equal(latest.sequence, index + 1);
        }

        asHost();
        assert.equal((await walletEscrow.getEscrowStatus(addressBase)).amount_earned, 4 * PORTION);
    });

    test('the proof that passes after the stretch earns its own interval, not the missed ones', async() => {
        at(8);
        latest = await nextProof();
        assert.equal(latest.total_amount, 5 * PORTION);
    });

    test('the host claims with the latest receipt; what is not earned goes back to the escrow', async() => {
        asHost();
        const result = await walletEscrow.claim(addressBase);
        assert.equal(result.amount_claimed, 5 * PORTION);
        assert.equal(result.amount_returned, 7 * PORTION);
        assert.deepEqual(sent.outputList, [
            walletOutput(5 * PORTION - FEE),
            escrowOutput(rental.terms, 7 * PORTION)
        ]);
        assert.equal(sent.signer.public_key, host.public_key);
        assert.equal(sent.escrowEntry.action, 'claim');
        assert.deepEqual(sent.escrowEntry.receipt, latest);

        // every node accepts the claim it builds
        assert.equal(isValidTransaction(sentTransaction()), true);
        lockedMap.set(addressBase, 7 * PORTION);
    });

    test('nothing is left to claim until a newer receipt', async() => {
        asHost();
        await assert.rejects(walletEscrow.claim(addressBase), error => error === 'escrow_claim_amount_too_small');
    });

    test('a proof that ran late earns the intervals that ended since the proof before it', async() => {
        // no proof ran at the end of interval 9
        at(10, 5);
        latest = await nextProof();
        assert.equal(latest.total_amount, 7 * PORTION);
    });

    test('the last proofs of the period, the last one after its end', async() => {
        at(11);
        latest = await nextProof();
        assert.equal(latest.total_amount, 8 * PORTION);

        at(12, 90);
        assert.ok(clock > rental.period_end);
        latest = await nextProof();
        // 12 intervals, 3 of them missed
        assert.equal(latest.total_amount, 9 * PORTION);
        assert.equal(latest.total_bytes, 9 * config.CLOUD_STORAGE_PROOF_BYTES);
    });

    test('after the period no proof is due', async() => {
        at(13);
        await assert.rejects(sign(rental), error => error === 'storage_receipt_not_due');
        at(14);
        await assert.rejects(sign(rental, false), error => error === 'storage_receipt_not_due');
    });

    test('a second claim takes only what the newer receipts added', async() => {
        asHost();
        const result = await walletEscrow.claim(addressBase);
        assert.equal(result.amount_claimed, 4 * PORTION);
        assert.equal(result.amount_returned, 3 * PORTION);
        assert.deepEqual(sent.escrowEntry.receipt, latest);

        const transaction = buildTransaction({
            inputList : sent.inputList,
            outputList: sent.outputList,
            signerList: [sent.signer],
            metadata  : {escrow: [sent.escrowEntry]}
        });
        assert.equal(isValidTransaction(transaction), true);
        lockedMap.set(addressBase, 3 * PORTION);
    });

    test('an older receipt of the rental claims what it earned, never what a newer one did', () => {
        // the receipt of 4 portions, the last before the missed stretch
        const older = signedList[4];
        assert.equal(older.receipt.total_amount, 4 * PORTION);
        const claim = portionCount => buildTransaction({
            inputList : [escrowInput(escrow.getEscrowAddress(rental.terms), 12 * PORTION)],
            outputList: [walletOutput(portionCount * PORTION - FEE), escrowOutput(rental.terms, (12 - portionCount) * PORTION)],
            signerList: [host],
            metadata  : {
                escrow: [
                    {
                        address_base     : addressBase,
                        action           : 'claim',
                        terms            : rental.terms,
                        receipt          : older.receipt,
                        receipt_signature: older.receipt_signature
                    }
                ]
            }
        });
        assert.equal(isValidTransaction(claim(4)), true);
        assert.equal(isValidTransaction(claim(9)), false);
    });

    test('before the unlock date the renter cannot take the rest back', async() => {
        asRenter();
        clock = rental.terms.unlock_date - 1;
        await assert.rejects(walletEscrow.refund(addressBase), error => error === 'escrow_locked');
    });

    test('at the unlock date the rent of the missed proofs returns to the renter, signed by the pass key', async() => {
        asRenter();
        clock        = rental.terms.unlock_date;
        const result = await walletEscrow.refund(addressBase);
        assert.equal(result.amount_refunded, 3 * PORTION);
        assert.deepEqual(sent.outputList, [walletOutput(3 * PORTION - FEE, renterWallet)]);
        assert.equal(sent.signer.public_key, renterPass.public_key);
        assert.equal(sent.escrowEntry.action, 'refund');

        assert.equal(isValidTransaction(sentTransaction(rental.terms.unlock_date)), true);
        assert.equal(isValidTransaction(sentTransaction(rental.terms.unlock_date - 1)), false);
        lockedMap.set(addressBase, 0);
    });

    test('after the unlock date the renter signs no receipt', async() => {
        clock = rental.terms.unlock_date;
        await assert.rejects(sign(rental), error => error === 'escrow_unlocked');
    });
});

describe('signing receipts (renter)', () => {
    test('proofs that pass every interval earn the whole rent, and never more', async() => {
        clock        = startDate;
        const rental = await openRental();
        let receipt;
        for (let index = 1; index <= 12; index++) {
            clock     = startDate + index * INTERVAL;
            ({receipt} = await proof(rental));
        }
        assert.equal(receipt.total_amount, rental.terms.amount);
        assert.equal(receipt.sequence, 13);

        clock = startDate + 13 * INTERVAL;
        await assert.rejects(sign(rental), error => error === 'storage_receipt_not_due');

        asHost();
        const result = await walletEscrow.claim(rental.escrow_address_base);
        assert.equal(result.amount_claimed, 12 * PORTION);
        assert.equal(result.amount_returned, 0);
        assert.deepEqual(sent.outputList, [walletOutput(12 * PORTION - FEE)]);
        assert.equal(isValidTransaction(sentTransaction()), true);
    });

    test(`a proof after a long silence earns at most ${config.CLOUD_STORAGE_PROOF_PORTION_MAX} intervals`, async() => {
        clock        = startDate;
        const rental = await openRental();
        // the renter's storage service was off for 8 intervals: nothing was
        // proven in them
        clock        = startDate + 8 * INTERVAL + 10;
        const first  = await proof(rental);
        assert.equal(first.receipt.total_amount, config.CLOUD_STORAGE_PROOF_PORTION_MAX * PORTION);
        clock        = startDate + 9 * INTERVAL + 10;
        const second = await proof(rental);
        assert.equal(second.receipt.total_amount, (config.CLOUD_STORAGE_PROOF_PORTION_MAX + 1) * PORTION);
    });

    test('a host that never passes a proof earns nothing, and the whole rent returns at the unlock date', async() => {
        clock        = startDate;
        const rental = await openRental();
        let receipt;
        for (let index = 1; index <= 12; index++) {
            clock     = startDate + index * INTERVAL;
            ({receipt} = await proof(rental, false));
        }
        assert.equal(receipt.total_amount, 0);
        assert.equal(receipt.period_end, rental.period_end);

        asHost();
        await assert.rejects(walletEscrow.claim(rental.escrow_address_base), error => error === 'escrow_claim_amount_too_small');

        asRenter();
        clock        = rental.terms.unlock_date;
        const result = await walletEscrow.refund(rental.escrow_address_base);
        assert.equal(result.amount_refunded, 12 * PORTION);
        assert.equal(isValidTransaction(sentTransaction()), true);
    });

    test('two proofs reported at once sign one receipt', async() => {
        clock         = startDate;
        const rental  = await openRental();
        clock         = startDate + INTERVAL;
        asRenter();
        const results = await Promise.allSettled([
            cloudStorage.signReceipt(rental.escrow_address_base, true),
            cloudStorage.signReceipt(rental.escrow_address_base, true)
        ]);
        assert.equal(results[0].status, 'fulfilled');
        assert.equal(results[0].value.receipt.sequence, 2);
        assert.equal(results[0].value.receipt.total_amount, PORTION);
        assert.equal(results[1].status, 'rejected');
        assert.equal(results[1].reason, 'storage_receipt_not_due');
        assert.deepEqual((await renterRepository.getEscrow(rental.escrow_address_base)).receipt, results[0].value.receipt);
    });

    test('only a passed proof earns: anything but true is a missed proof', async() => {
        clock        = startDate;
        const rental = await openRental();
        clock        = startDate + INTERVAL;
        asRenter();
        const signed = await cloudStorage.signReceipt(rental.escrow_address_base, 'true');
        assert.equal(signed.receipt.total_amount, 0);
        assert.equal(signed.amount_earned, 0);
        assert.equal(signed.amount, 12 * PORTION);
    });

    test('the host\'s node does not sign receipts for an escrow that pays it', async() => {
        clock        = startDate;
        const rental = await openRental();
        clock        = startDate + INTERVAL;
        asHost();
        await assert.rejects(cloudStorage.signReceipt(rental.escrow_address_base, true), error => error === 'escrow_not_found');
        await assert.rejects(cloudStorage.signReceipt(other.address_base, true), error => error === 'escrow_not_found');
    });

    test('an escrow opened for data carried signs no storage receipt', async() => {
        asRenter();
        clock              = startDate;
        const {terms}      = await walletEscrow.createEscrow(host.public_key, host.address_base, config.VPN_ESCROW_PORTION_BYTES, config.VPN_ESCROW_PORTION_AMOUNT, 20, startDate + PERIOD);
        clock              = startDate + INTERVAL;
        await assert.rejects(cloudStorage.signReceipt(escrow.getEscrowAddress(terms).address_base, true), error => error === 'escrow_not_storage');
    });
});

describe('receipts the host refuses', () => {
    let rental, addressBase, first, second;

    function add(signed, terms = rental.terms) {
        asHost();
        return cloudStorage.addReceipt(terms, signed.receipt, signed.signature, rental.funding_transaction_id);
    }

    async function assertUnchanged() {
        const escrowRecord = await hostRepository.getEscrow(addressBase);
        assert.deepEqual(escrowRecord.receipt, second.receipt);
        assert.equal(escrowRecord.receipt_signature, second.receipt_signature);
        assert.equal(escrowRecord.receipt_sequence, 3);
        assert.equal(escrowRecord.receipt_total_bytes, 2 * config.CLOUD_STORAGE_PROOF_BYTES);
    }

    before(async() => {
        clock       = startDate;
        rental      = await openRental();
        addressBase = rental.escrow_address_base;
        clock       = startDate + INTERVAL;
        first       = await sign(rental);
        await add({receipt: first.receipt, signature: first.receipt_signature});
        clock       = startDate + 2 * INTERVAL;
        second      = await sign(rental);
        await add({receipt: second.receipt, signature: second.receipt_signature});
    });

    test('a forged receipt: signed by another key, or by the host', async() => {
        const next = {sequence: 4, total_bytes: 12 * config.CLOUD_STORAGE_PROOF_BYTES, total_amount: 12 * PORTION};
        await assert.rejects(add(signedReceipt(second.receipt, next, other)), error => error === 'receipt_not_accepted');
        await assert.rejects(add(signedReceipt(second.receipt, next, host)), error => error === 'receipt_not_accepted');
        await assertUnchanged();
    });

    test('a receipt changed after the renter signed it', async() => {
        const changed = {
            receipt  : {
                ...second.receipt,
                sequence    : 4,
                total_bytes : 12 * config.CLOUD_STORAGE_PROOF_BYTES,
                total_amount: 12 * PORTION
            },
            signature: second.receipt_signature
        };
        await assert.rejects(add(changed), error => error === 'receipt_not_accepted');
        await assertUnchanged();
    });

    test('a replayed receipt: the latest one again, or an older one', async() => {
        await assert.rejects(add({receipt: second.receipt, signature: second.receipt_signature}), error => error === 'receipt_not_newer');
        await assert.rejects(add({receipt: first.receipt, signature: first.receipt_signature}), error => error === 'receipt_not_newer');
        await assert.rejects(add({receipt: rental.receipt, signature: rental.receipt_signature}), error => error === 'receipt_not_newer');
        await assertUnchanged();
    });

    test('a receipt with a newer sequence and a lower total', async() => {
        await assert.rejects(add(signedReceipt(second.receipt, {
            sequence    : 4,
            total_bytes : config.CLOUD_STORAGE_PROOF_BYTES,
            total_amount: PORTION
        })), error => error === 'receipt_not_newer');
        await assertUnchanged();
    });

    test('a receipt of another escrow, given with this escrow\'s terms', async() => {
        clock             = startDate;
        const otherRental = await openRental();
        clock             = startDate + 3 * INTERVAL;
        const signed      = await sign(otherRental);
        assert.equal(signed.receipt.total_amount, 2 * PORTION);
        await assert.rejects(add({receipt: signed.receipt, signature: signed.receipt_signature}), error => error === 'receipt_not_accepted');
        // even with a sequence and a total beyond this escrow's
        await assert.rejects(add(signedReceipt(signed.receipt, {sequence: 9, total_bytes: 8 * config.CLOUD_STORAGE_PROOF_BYTES, total_amount: 8 * PORTION})), error => error === 'receipt_not_accepted');
        await assertUnchanged();

        // with its own terms the host takes it for its own escrow
        asHost();
        const result = await cloudStorage.addReceipt(otherRental.terms, signed.receipt, signed.receipt_signature);
        assert.equal(result.escrow_address_base, otherRental.escrow_address_base);
        assert.equal(result.amount_earned, 2 * PORTION);
        await assertUnchanged();
    });

    test('a receipt for another copy, or another rental period, of the same escrow', async() => {
        const next = {sequence: 4, total_bytes: 3 * config.CLOUD_STORAGE_PROOF_BYTES, total_amount: 3 * PORTION};
        await assert.rejects(add(signedReceipt(second.receipt, {...next, copy_id: newCopyID()})), error => error === 'receipt_not_for_this_copy');
        await assert.rejects(add(signedReceipt(second.receipt, {...next, period_start: startDate + 1, period_end: startDate + 3 * INTERVAL})), error => error === 'receipt_not_for_this_copy');
        await assertUnchanged();
    });

    test('a receipt for data carried, on a storage escrow', async() => {
        const {copy_id, period_start, period_end, total_amount, ...body} = second.receipt;
        await assert.rejects(add(signedReceipt(body, {sequence: 4, total_bytes: 12 * config.CLOUD_STORAGE_PROOF_BYTES})), error => error === 'receipt_not_accepted');
        await assertUnchanged();
    });

    test('the receipt after all those is still accepted', async() => {
        clock        = startDate + 3 * INTERVAL;
        const third  = await sign(rental);
        const result = await add({receipt: third.receipt, signature: third.receipt_signature});
        assert.equal(result.receipt_sequence, 4);
        assert.equal(result.amount_earned, 3 * PORTION);
    });
});

describe('escrows the host does not record', () => {
    // a rental opened at the renter's node, not yet known to the host
    async function unknownRental() {
        asRenter();
        clock = startDate;
        return cloudStorage.openRental(offer.offer_id, newCopyID(), SIZE, PERIOD);
    }

    function add(rental, terms = rental.terms, receipt = rental.receipt, signature = rental.receipt_signature) {
        asHost();
        return cloudStorage.addReceipt(terms, receipt, signature, rental.funding_transaction_id);
    }

    /**
     * terms and a first receipt signed outside the node
     */
    function handmade(termsOverrides = {}) {
        const terms         = {
            version         : config.ESCROW_TERMS_VERSION,
            payer_public_key: renterPass.public_key,
            payee_public_key: host.public_key,
            amount          : 12 * PORTION,
            portion_bytes   : config.CLOUD_STORAGE_PROOF_BYTES,
            portion_amount  : PORTION,
            unlock_date     : startDate + 2 * PERIOD,
            nonce           : newNonce(),
            ...termsOverrides
        };
        const escrowAddress = escrow.getEscrowAddress(terms);
        lockedMap.set(escrowAddress.address_base, terms.amount);
        const {receipt, signature} = signedReceipt({
            version            : config.ESCROW_RECEIPT_VERSION,
            escrow_address_base: escrowAddress.address_base,
            node_id            : escrow.getAddressFromPublicKey(terms.payee_public_key),
            copy_id            : newCopyID(),
            period_start       : startDate,
            period_end         : startDate,
            total_bytes        : 0,
            total_amount       : 0,
            sequence           : 1,
            receipt_date       : startDate
        });
        return {
            terms,
            receipt,
            receipt_signature     : signature,
            escrow_address_base   : escrowAddress.address_base,
            funding_transaction_id: 'F'.repeat(50)
        };
    }

    test('an escrow that is not funded yet: it asks the network for the funding transaction, and records it once funded', async() => {
        const rental       = await unknownRental();
        const addressBase  = rental.escrow_address_base;
        const requestCount = requestedList.length;
        lockedMap.set(addressBase, 0);
        await assert.rejects(add(rental), error => error === 'escrow_not_funded');
        assert.equal(requestedList.length, requestCount + 1);
        assert.equal(requestedList.at(-1), rental.funding_transaction_id);
        assert.equal(await hostRepository.getEscrow(addressBase), undefined);

        // funded with less than the rent
        lockedMap.set(addressBase, 12 * PORTION - 1);
        await assert.rejects(add(rental), error => error === 'escrow_not_funded');
        assert.equal(await hostRepository.getEscrow(addressBase), undefined);

        lockedMap.set(addressBase, 12 * PORTION);
        assert.equal((await add(rental)).receipt_sequence, 1);
        assert.equal((await hostRepository.getEscrow(addressBase)).role, 'payee');
    });

    test('an escrow that pays another node', async() => {
        const rental = handmade({payee_public_key: other.public_key});
        await assert.rejects(add(rental), error => error === 'escrow_not_for_this_node');
        assert.equal(await hostRepository.getEscrow(rental.escrow_address_base), undefined);
    });

    test('malformed terms', async() => {
        const rental = handmade();
        await assert.rejects(add(rental, {...rental.terms, amount: 1.5}), error => error === 'escrow_invalid_terms');
        await assert.rejects(add(rental, null), error => error === 'escrow_invalid_terms');
    });

    test('terms the first receipt was not signed for', async() => {
        const rental = handmade();
        await assert.rejects(add(rental, {...rental.terms, amount: 24 * PORTION}), error => error === 'receipt_not_accepted');
    });

    test('an escrow without a receipt signed by its pass key', async() => {
        const rental = handmade();
        const forged = signedReceipt(rental.receipt, {}, other);
        await assert.rejects(add(rental, rental.terms, forged.receipt, forged.signature), error => error === 'receipt_not_accepted');
        await assert.rejects(add(rental, rental.terms, null, null), error => error === 'receipt_not_accepted');
        assert.equal(await hostRepository.getEscrow(rental.escrow_address_base), undefined);
    });

    test('an escrow that is already unlocked, or stays locked longer than ESCROW_UNLOCK_DURATION_MAX', async() => {
        clock = startDate;
        await assert.rejects(add(handmade({unlock_date: startDate})), error => error === 'escrow_unlock_date_not_accepted');
        await assert.rejects(add(handmade({unlock_date: startDate + config.ESCROW_UNLOCK_DURATION_MAX + 1})), error => error === 'escrow_unlock_date_not_accepted');
        assert.equal((await add(handmade({unlock_date: startDate + config.ESCROW_UNLOCK_DURATION_MAX}))).receipt_sequence, 1);
    });

    test('an escrow before the escrow activation date', async() => {
        clock                 = startDate;
        const restoreActivation = setEscrowActivationDate(startDate + 1);
        try {
            await assert.rejects(add(handmade()), error => error === 'escrow_not_active');
        }
        finally {
            restoreActivation();
        }
    });
});
