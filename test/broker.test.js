import {after, before, beforeEach, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import _ from 'lodash';
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import config from '../core/config/config';
import network from '../net/network';
import wallet from '../core/wallet/wallet';
import walletUtils from '../core/wallet/wallet-utils';
import cloudPass, {CLOUD_PASS_VERSION, GB} from '../net/broker/cloud-pass';
import broker from '../net/broker/broker';
import passWallet from '../net/broker/pass-wallet';
import cloudOffer from '../net/cloud-offer';
import cloudVersion from '../net/cloud-version';
import vpnExit from '../net/vpn/vpn-exit';
import vpnClient from '../net/vpn/vpn-client';
import * as nodeRequest from '../net/broker/node-request';
import CloudBrokerRepository from '../database/repositories/cloud-broker';
import CloudPassRepository from '../database/repositories/cloud-pass';
import CloudNoticeRepository from '../database/repositories/cloud-notice';
import {fullAddress, newKey, now, openCloudDatabase, stubRepositories, VERSION} from './helper';

const brokerKey  = newKey();
const brokerNode = newKey();
const exitNode   = newKey();
const otherExit  = newKey();
const holder     = newKey();
const attacker   = newKey();
const exitWallet = newKey();
const brokerAddress = fullAddress(brokerKey);

const PIECE_BYTES = 1024 * 1024;
const PIECE_COUNT = 4;

const restore = [];

function stubMethod(object, name, value, restoreList = restore) {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    Object.defineProperty(object, name, {
        value,
        configurable: true,
        writable    : true
    });
    restoreList.push(() => descriptor ? Object.defineProperty(object, name, descriptor) : delete object[name]);
}

function certificateBody(overrides = {}, certificateKey = newKey()) {
    const startDate = now();
    return {
        version               : CLOUD_PASS_VERSION,
        broker_address        : brokerAddress,
        broker_public_key     : brokerKey.public_key,
        certificate_public_key: certificateKey.public_key,
        holder_public_key     : holder.public_key,
        funding_transaction_id: 'F'.repeat(50),
        data_bytes            : PIECE_BYTES * PIECE_COUNT,
        piece_bytes           : PIECE_BYTES,
        piece_count           : PIECE_COUNT,
        start_date            : startDate,
        end_date              : startDate + 7 * 24 * 3600,
        ...overrides
    };
}

function receiptFor(certificate, nodeID, totalBytes, sequence, signer = holder, overrides = {}) {
    const receipt = {
        version       : CLOUD_PASS_VERSION,
        certificate_id: certificate.certificate_id,
        node_id       : nodeID,
        piece_index   : 0,
        total_bytes   : totalBytes,
        sequence,
        receipt_date  : now(),
        ...overrides
    };
    return {
        certificate_id: certificate.certificate_id,
        receipt,
        signature     : cloudPass.signReceipt(receipt, signer.private_key)
    };
}

function hostReport(node, receiptList, overrides = {}) {
    return cloudPass.signHostReport({
        node_id        : node.address_base,
        node_public_key: node.public_key,
        payout_address : fullAddress(exitWallet),
        report_date    : now(),
        receipt_list   : receiptList,
        ...overrides
    }, node.node_private_key);
}

let brokerRepository, passRepository;
const paymentMap = new Map();

before(async() => {
    const database   = await openCloudDatabase();
    brokerRepository = new CloudBrokerRepository(database);
    passRepository   = new CloudPassRepository(database);
    restore.push(stubRepositories({
        cloud_broker: brokerRepository,
        cloud_pass  : passRepository,
        cloud_notice: new CloudNoticeRepository(database),
        transaction : {
            getTransactionObject : transactionID => paymentMap.has(transactionID) ? Promise.resolve(paymentMap.get(transactionID).transaction) : Promise.reject('transaction_not_found'),
            listTransactionOutput: where => Promise.resolve((paymentMap.get(where['transaction_output.transaction_id'])?.output_list || [])
                .filter(output => output.address === where['transaction_output.address']))
        },
        cloud_offer : {
            getOffer: () => Promise.resolve(exitOffer)
        }
    }));
    stubMethod(broker, 'getBrokerKey', () => ({
        ...brokerKey,
        address_version       : VERSION.address_wallet,
        address_key_identifier: brokerKey.address_base,
        address               : brokerAddress
    }));
    stubMethod(network, 'nodeID', brokerNode.address_base);
    stubMethod(wallet, 'requestTransactionFromNetwork', () => undefined);
    stubMethod(config, 'CLOUD_BROKER_PASS_DATA_BYTES', PIECE_BYTES * PIECE_COUNT);
    stubMethod(config, 'CLOUD_BROKER_PASS_PIECE_BYTES', PIECE_BYTES);
    stubMethod(config, 'CLOUD_BROKER_PASS_PRICE', 5000000);
    stubMethod(config, 'CLOUD_BROKER_POOL_RATE', 150000);
    stubMethod(config, 'CLOUD_BROKER_PAYOUT_AMOUNT_MIN', 100);
});
after(() => restore.reverse().forEach(fn => fn()));

let exitOffer = null;

/**
 * a stable payment of the pass price to the broker naming the holder key
 */
function addPayment(transactionID, overrides = {}) {
    const {
              amount = config.CLOUD_BROKER_PASS_PRICE,
              is_stable: isStable = 1,
              version = VERSION.transaction_signed,
              metadata = {
                  cloud_pass: {
                      holder_public_key: holder.public_key,
                      broker_address   : brokerAddress
                  }
              }
          } = overrides;
    paymentMap.set(transactionID, {
        transaction: {
            transaction_id              : transactionID,
            version,
            transaction_output_attribute: {transaction_output_metadata: metadata}
        },
        output_list: [
            {
                transaction_id    : transactionID,
                output_position   : 0,
                address           : brokerAddress,
                amount,
                is_stable         : isStable,
                is_double_spend   : 0,
                status            : 1,
                transaction_status: 1
            }
        ]
    });
}

function certificateRequest(transactionID, signer = holder) {
    return {
        funding_transaction_id: transactionID,
        holder_public_key     : holder.public_key,
        signature             : cloudPass.signHolderMessage({
            funding_transaction_id: transactionID,
            broker_node_id        : brokerNode.address_base
        }, signer.private_key)
    };
}

function pieceRequest(certificate, pieceIndex, signer = holder) {
    return {
        certificate_id: certificate.certificate_id,
        piece_index   : pieceIndex,
        signature     : cloudPass.signHolderMessage({
            certificate_id: certificate.certificate_id,
            piece_index   : pieceIndex
        }, signer.private_key)
    };
}

let transactionCount = 0;

function newTransactionID() {
    transactionCount++;
    return `${transactionCount}`.padStart(50, 'T');
}

/**
 * a certificate and its pieces, issued by the broker node
 */
async function asBroker(fn) {
    const nodeID   = network.nodeID;
    network.nodeID = brokerNode.address_base;
    try {
        return await fn();
    }
    finally {
        network.nodeID = nodeID;
    }
}

async function issueCertificate() {
    const transactionID = newTransactionID();
    addPayment(transactionID);
    const {certificate} = await asBroker(() => broker.issueCertificate(certificateRequest(transactionID)));
    return certificate;
}

function issuePiece(certificate, pieceIndex) {
    return asBroker(() => broker.issuePiece(pieceRequest(certificate, pieceIndex))).then(({piece}) => piece);
}


describe('pass records (cloud-pass)', () => {
    const certificateKey = newKey();
    const certificate    = cloudPass.signCertificate(certificateBody({}, certificateKey), brokerKey.private_key);

    test('a certificate signed by the broker key verifies', () => {
        assert.deepEqual(cloudPass.verifyCertificate(certificate, now()), {valid: true});
    });

    for (const [name, build, reason] of [
        ['changed after signing', () => ({...certificate, data_bytes: certificate.data_bytes * 2, piece_count: certificate.piece_count * 2}), 'certificate_invalid_id'],
        ['for another holder with its id recomputed', () => {
            const body = {...cloudPass.getCertificateBody(certificate), holder_public_key: attacker.public_key};
            return {...body, certificate_id: cloudPass.signCertificate(body, attacker.private_key).certificate_id, broker_signature: certificate.broker_signature};
        }, 'certificate_invalid_signature'],
        ['signed by another key in the broker\'s name', () => cloudPass.signCertificate(certificateBody(), attacker.private_key), 'certificate_invalid_signature'],
        ['naming a broker key that is not its address\'s', () => cloudPass.signCertificate(certificateBody({broker_public_key: attacker.public_key}), attacker.private_key), 'certificate_invalid_broker'],
        ['past its end date', () => cloudPass.signCertificate(certificateBody({start_date: now() - 7200, end_date: now() - 1}), brokerKey.private_key), 'certificate_expired'],
        ['longer than CLOUD_PASS_DURATION_MAX', () => cloudPass.signCertificate(certificateBody({end_date: now() + config.CLOUD_PASS_DURATION_MAX + 60}), brokerKey.private_key), 'certificate_invalid_date'],
        ['whose data is not its pieces', () => cloudPass.signCertificate(certificateBody({data_bytes: PIECE_BYTES * PIECE_COUNT + 1}), brokerKey.private_key), 'certificate_invalid_format'],
        ['with more than CLOUD_PASS_PIECE_COUNT_MAX pieces', () => cloudPass.signCertificate(certificateBody({
            piece_count: config.CLOUD_PASS_PIECE_COUNT_MAX + 1,
            data_bytes : PIECE_BYTES * (config.CLOUD_PASS_PIECE_COUNT_MAX + 1)
        }), brokerKey.private_key), 'certificate_invalid_format'],
        ['without its signature', () => {
            const unsigned = {...certificate};
            delete unsigned.broker_signature;
            return unsigned;
        }, 'certificate_invalid_format']
    ]) {
        test(`refuses a certificate ${name}`, () => assert.deepEqual(cloudPass.verifyCertificate(build(), now()), {
            valid: false,
            reason
        }));
    }

    test('a piece signed by the certificate key is valid, for each index below piece_count', () => {
        for (let index = 0; index < PIECE_COUNT; index++) {
            assert.equal(cloudPass.isValidPiece(certificate, cloudPass.signPiece(certificate, index, certificateKey.private_key)), true);
        }
        assert.equal(cloudPass.isValidPiece(certificate, cloudPass.signPiece(certificate, PIECE_COUNT, certificateKey.private_key)), false);
    });

    test('refuses a piece signed by the broker key, the holder key or another key', () => {
        for (const key of [brokerKey, holder, attacker]) {
            assert.equal(cloudPass.isValidPiece(certificate, cloudPass.signPiece(certificate, 0, key.private_key)), false);
        }
    });

    test('refuses a piece of another certificate, or changed after signing', () => {
        const otherCertificate = cloudPass.signCertificate(certificateBody({funding_transaction_id: 'G'.repeat(50)}, certificateKey), brokerKey.private_key);
        assert.equal(cloudPass.isValidPiece(certificate, cloudPass.signPiece(otherCertificate, 0, certificateKey.private_key)), false);
        const piece = cloudPass.signPiece(certificate, 0, certificateKey.private_key);
        assert.equal(cloudPass.isValidPiece(certificate, {...piece, piece_index: 1}), false);
        assert.equal(cloudPass.isValidPiece(certificate, {...piece, piece_bytes: GB}), false);
    });

    test('a receipt is valid only from the holder key, for the node it names', () => {
        const {receipt, signature} = receiptFor(certificate, exitNode.address_base, 1000, 1);
        assert.equal(cloudPass.isValidReceipt(certificate, receipt, signature, exitNode.address_base), true);
        assert.equal(cloudPass.isValidReceipt(certificate, receipt, signature, otherExit.address_base), false);
        const forged = receiptFor(certificate, exitNode.address_base, 1000, 1, attacker);
        assert.equal(cloudPass.isValidReceipt(certificate, forged.receipt, forged.signature, exitNode.address_base), false);
        assert.equal(cloudPass.isValidReceipt(certificate, {...receipt, total_bytes: 9999}, signature, exitNode.address_base), false);
    });

    test('broker terms are valid when signed by the broker key for the node that serves them', () => {
        const terms = {
            address         : brokerAddress,
            public_key      : brokerKey.public_key,
            pass_price      : 5000000,
            pass_data_bytes : 25 * GB,
            pass_piece_bytes: GB,
            pass_duration   : 7 * 24 * 3600,
            pool_rate       : 150000,
            payout_interval : 3600
        };
        const signed = cloudPass.signBrokerTerms(terms, brokerNode.address_base, brokerKey.private_key);
        assert.equal(cloudPass.isValidBrokerTerms(signed, brokerNode.address_base), true);
        // another node cannot serve them, nor another key sign them
        assert.equal(cloudPass.isValidBrokerTerms(signed, attacker.address_base), false);
        assert.equal(cloudPass.isValidBrokerTerms(cloudPass.signBrokerTerms(terms, brokerNode.address_base, attacker.private_key), brokerNode.address_base), false);
        // a pass may never pay out more than it costs: 25 GB at 200,001 per GB
        assert.equal(cloudPass.isValidBrokerTerms(cloudPass.signBrokerTerms({...terms, pool_rate: 200001}, brokerNode.address_base, brokerKey.private_key), brokerNode.address_base), false);
        assert.equal(cloudPass.isValidBrokerTerms(cloudPass.signBrokerTerms({...terms, pool_rate: 200000}, brokerNode.address_base, brokerKey.private_key), brokerNode.address_base), true);
    });

    test('a host report verifies with the node key of the node it names', () => {
        const entry = receiptFor(certificate, exitNode.address_base, 1000, 1);
        assert.deepEqual(cloudPass.verifyHostReport(hostReport(exitNode, [entry])), {valid: true});
        assert.deepEqual(cloudPass.verifyHostReport({...hostReport(exitNode, [entry]), payout_address: fullAddress(attacker)}), {
            valid : false,
            reason: 'report_invalid_signature'
        });
        assert.deepEqual(cloudPass.verifyHostReport(hostReport(attacker, [entry], {node_id: exitNode.address_base})), {
            valid : false,
            reason: 'report_invalid_signature'
        });
        assert.equal(cloudPass.verifyHostReport({...hostReport(exitNode, [entry]), receipt_list: []}).reason, 'report_invalid_format');
        assert.equal(cloudPass.verifyHostReport(hostReport(exitNode, Array(config.CLOUD_BROKER_REPORT_RECEIPT_MAX + 1).fill(entry))).reason, 'report_invalid_format');
    });

    test('the payout is whole millix at the pool rate per GB', () => {
        assert.equal(cloudPass.getPayoutAmount(GB, 150000), 150000);
        assert.equal(cloudPass.getPayoutAmount(GB / 2, 150000), 75000);
        assert.equal(cloudPass.getPayoutAmount(1000000, 150000), 139);
        assert.equal(cloudPass.getPayoutAmount(1000, 150000), 0);
        assert.equal(cloudPass.getPayoutAmount(25 * GB, 150000), 3750000);
    });
});

describe('broker: selling certificates', () => {
    test('issues a certificate for a stable payment naming the holder key', async() => {
        const transactionID = newTransactionID();
        addPayment(transactionID);
        const {certificate} = await broker.issueCertificate(certificateRequest(transactionID));
        assert.deepEqual(cloudPass.verifyCertificate(certificate, now()), {valid: true});
        assert.equal(certificate.holder_public_key, holder.public_key);
        assert.equal(certificate.broker_address, brokerAddress);
        assert.equal(certificate.piece_count, PIECE_COUNT);
        assert.equal(certificate.data_bytes, config.CLOUD_BROKER_PASS_DATA_BYTES);
        // the certificate key is the broker's derived key for this payment
        assert.equal(certificate.certificate_public_key, cloudPass.getPublicKey(cloudPass.deriveCertificatePrivateKey(brokerKey.private_key, transactionID)));
    });

    test('a second request for the same payment returns the same certificate', async() => {
        const transactionID = newTransactionID();
        addPayment(transactionID);
        const first  = await broker.issueCertificate(certificateRequest(transactionID));
        const second = await broker.issueCertificate(certificateRequest(transactionID));
        assert.deepEqual(second, first);
    });

    for (const [name, payment, reason] of [
        ['a payment it has not seen', null, 'payment_not_found'],
        ['a payment that is not stable yet', {is_stable: 0}, 'payment_not_stable'],
        ['a payment below the pass price', {amount: 4999999}, 'payment_too_small'],
        ['a payment naming another holder key', {metadata: {cloud_pass: {holder_public_key: attacker.public_key, broker_address: brokerAddress}}}, 'payment_not_for_this_pass'],
        ['a payment naming another broker', {metadata: {cloud_pass: {holder_public_key: holder.public_key, broker_address: fullAddress(attacker)}}}, 'payment_not_for_this_pass'],
        ['a payment without pass metadata', {metadata: {note: 'x'}}, 'payment_not_for_this_pass'],
        [`a payment in version ${VERSION.transaction} (metadata not signed)`, {version: VERSION.transaction}, 'payment_not_for_this_pass']
    ]) {
        test(`refuses ${name}`, async() => {
            const transactionID = newTransactionID();
            payment && addPayment(transactionID, payment);
            await assert.rejects(broker.issueCertificate(certificateRequest(transactionID)), error => error === reason);
        });
    }

    test('refuses a request not signed by the holder key', async() => {
        const transactionID = newTransactionID();
        addPayment(transactionID);
        await assert.rejects(broker.issueCertificate(certificateRequest(transactionID, attacker)), error => error === 'certificate_request_invalid');
    });

    test('refuses someone else\'s payment: the holder key is named in the signed payment', async() => {
        // the attacker sees the payment and asks for a certificate with its
        // own key
        const transactionID = newTransactionID();
        addPayment(transactionID);
        const request = {
            funding_transaction_id: transactionID,
            holder_public_key     : attacker.public_key,
            signature             : cloudPass.signHolderMessage({
                funding_transaction_id: transactionID,
                broker_node_id        : brokerNode.address_base
            }, attacker.private_key)
        };
        await assert.rejects(broker.issueCertificate(request), error => error === 'payment_not_for_this_pass');
    });
});

describe('broker: pieces', () => {
    test('issues pieces in order, each signed by the certificate key', async() => {
        const certificate = await issueCertificate();
        for (let index = 0; index < PIECE_COUNT; index++) {
            const {piece} = await broker.issuePiece(pieceRequest(certificate, index));
            assert.equal(cloudPass.isValidPiece(certificate, piece), true);
            assert.equal(piece.piece_index, index);
        }
        // a piece already issued can be fetched again
        assert.equal((await broker.issuePiece(pieceRequest(certificate, 1))).piece.piece_index, 1);
    });

    test('refuses a piece out of order, past piece_count or asked by another key', async() => {
        const certificate = await issueCertificate();
        await assert.rejects(broker.issuePiece(pieceRequest(certificate, 1)), error => error === 'piece_out_of_order');
        await broker.issuePiece(pieceRequest(certificate, 0));
        await assert.rejects(broker.issuePiece(pieceRequest(certificate, PIECE_COUNT)), error => error === 'piece_not_found');
        await assert.rejects(broker.issuePiece(pieceRequest(certificate, 1, attacker)), error => error === 'piece_request_invalid');
        await assert.rejects(broker.issuePiece({...pieceRequest(certificate, 0), certificate_id: 'x'.repeat(50)}), error => error === 'certificate_not_found');
    });
});

describe('broker: receipts and payouts', () => {
    let certificateA, certificateB;
    before(async() => {
        certificateA = await issueCertificate();
        certificateB = await issueCertificate();
    });

    test('stores the receipts of a signed report', async() => {
        const result = await broker.addReport(hostReport(exitNode, [
            receiptFor(certificateA, exitNode.address_base, PIECE_BYTES, 1),
            receiptFor(certificateB, exitNode.address_base, PIECE_BYTES / 2, 1)
        ]));
        assert.deepEqual(result.receipt_list.map(entry => entry.status), ['accepted', 'accepted']);
        assert.equal((await brokerRepository.getReceipt(certificateA.certificate_id, exitNode.address_base)).total_bytes, PIECE_BYTES);
    });

    test('accepts only receipts that move forward', async() => {
        const result = await broker.addReport(hostReport(exitNode, [
            receiptFor(certificateA, exitNode.address_base, PIECE_BYTES, 1),
            receiptFor(certificateA, exitNode.address_base, PIECE_BYTES - 1, 2),
            receiptFor(certificateA, exitNode.address_base, 2 * PIECE_BYTES, 3)
        ]));
        assert.deepEqual(result.receipt_list.map(entry => entry.status), ['receipt_not_newer', 'receipt_not_newer', 'accepted']);
        assert.equal((await brokerRepository.getReceipt(certificateA.certificate_id, exitNode.address_base)).total_bytes, 2 * PIECE_BYTES);
    });

    test('refuses receipts signed by another key, for another node or certificate', async() => {
        const result = await broker.addReport(hostReport(exitNode, [
            receiptFor(certificateA, exitNode.address_base, 3 * PIECE_BYTES, 9, attacker),
            receiptFor(certificateA, otherExit.address_base, 3 * PIECE_BYTES, 9),
            {...receiptFor(certificateA, exitNode.address_base, 3 * PIECE_BYTES, 9), certificate_id: 'x'.repeat(50)}
        ]));
        assert.deepEqual(result.receipt_list.map(entry => entry.status), ['receipt_invalid', 'receipt_invalid', 'certificate_not_found']);
    });

    test('refuses a report in another node\'s name', async() => {
        await assert.rejects(broker.addReport(hostReport(attacker, [receiptFor(certificateA, exitNode.address_base, 3 * PIECE_BYTES, 9)], {node_id: exitNode.address_base})),
            error => error === 'report_invalid_signature');
    });

    test('a certificate pays at most its data across exit nodes, earliest receipts first', async() => {
        // certificate A: exit node has 2 pieces receipted; the other exit
        // node receipts the whole certificate later
        const brokerNow = broker._now;
        broker._now     = () => brokerNow.call(broker) + 10;
        try {
            await broker.addReport(hostReport(otherExit, [receiptFor(certificateA, otherExit.address_base, PIECE_COUNT * PIECE_BYTES, 1)]));
        }
        finally {
            broker._now = brokerNow;
        }
        const earned = await broker.getEarnedAmountByNode();
        const rate   = config.CLOUD_BROKER_POOL_RATE;
        assert.equal(earned[exitNode.address_base], cloudPass.getPayoutAmount(2 * PIECE_BYTES, rate) + cloudPass.getPayoutAmount(PIECE_BYTES / 2, rate));
        assert.equal(earned[otherExit.address_base], cloudPass.getPayoutAmount((PIECE_COUNT - 2) * PIECE_BYTES, rate));
    });

    test('pays each exit node what it is owed once, the broker paying the fee', async() => {
        const sentList = [];
        stubMethod(wallet, 'addTransaction', (outputList, fee) => {
            sentList.push({outputList, fee});
            return Promise.resolve([{transaction_id: `${sentList.length}`.padStart(50, 'P')}]);
        });
        stubMethod(broker, 'server', {});
        try {
            const earned = await broker.getEarnedAmountByNode();
            await broker.doPayout();
            assert.equal(sentList.length, 1);
            assert.equal(sentList[0].fee.amount, config.TRANSACTION_FEE_PROXY);
            assert.deepEqual(new Set(sentList[0].outputList.map(output => output.amount)), new Set([earned[exitNode.address_base], earned[otherExit.address_base]]));
            assert.ok(sentList[0].outputList.every(output => output.address_base === exitWallet.address_base));
            // nothing more is owed
            await broker.doPayout();
            assert.equal(sentList.length, 1);
            const hostList = await broker.listHost();
            assert.ok(hostList.every(host => host.amount_owed === 0 && host.amount_paid === earned[host.node_id]));
        }
        finally {
            broker.server = null;
        }
    });

    test(`pays at most ${config.CLOUD_BROKER_PAYOUT_OUTPUT_MAX - 1} exit nodes per transaction, the last output being the change`, async() => {
        const sentList      = [];
        const restorePayout = [];
        stubMethod(wallet, 'addTransaction', outputList => {
            sentList.push(outputList);
            return Promise.resolve([{transaction_id: `${sentList.length}`.padStart(50, 'Q')}]);
        });
        stubMethod(broker, 'server', {});
        try {
            const certificateList = [];
            for (let i = 0; i < 3; i++) {
                certificateList.push(await issueCertificate());
            }
            // 130 exit nodes carry 1000 bytes each, at a pool rate that
            // pays them above the minimum
            stubMethod(config, 'CLOUD_BROKER_POOL_RATE', 200000000, restorePayout);
            for (let i = 0; i < 130; i++) {
                const node = newKey();
                await broker.addReport(hostReport(node, [receiptFor(certificateList[i % 3], node.address_base, 1000, 1)]));
            }
            const payableCount = (await broker.listHost()).filter(host => host.amount_owed >= config.CLOUD_BROKER_PAYOUT_AMOUNT_MIN).length;
            assert.ok(payableCount >= 130);
            await broker.doPayout();
            assert.deepEqual(sentList.map(outputList => outputList.length), [126, payableCount - 126]);
            assert.equal(config.CLOUD_BROKER_PAYOUT_OUTPUT_MAX - 1, 126);
            assert.ok((await broker.listHost()).every(host => host.amount_owed < config.CLOUD_BROKER_PAYOUT_AMOUNT_MIN));
        }
        finally {
            broker.server = null;
            restorePayout.reverse().forEach(fn => fn());
        }
    });

    test('does not pay an exit node owed less than CLOUD_BROKER_PAYOUT_AMOUNT_MIN', async() => {
        const sentList = [];
        stubMethod(wallet, 'addTransaction', outputList => {
            sentList.push(outputList);
            return Promise.resolve([{transaction_id: 'R'.repeat(50)}]);
        });
        stubMethod(broker, 'server', {});
        try {
            const certificate = await issueCertificate();
            const node        = newKey();
            // 600 bytes earn 83 millix, below the minimum of 100
            await broker.addReport(hostReport(node, [receiptFor(certificate, node.address_base, 600, 1)]));
            await broker.doPayout();
            assert.equal(sentList.length, 0);
        }
        finally {
            broker.server = null;
        }
    });
});

describe('exit node: broker passes', () => {
    const restoreExit = [];
    let certificate, pieceList;

    before(async() => {
        certificate = await issueCertificate();
        pieceList   = [];
        for (let index = 0; index < PIECE_COUNT; index++) {
            pieceList.push(await issuePiece(certificate, index));
        }
        stubMethod(network, 'nodeID', exitNode.address_base, restoreExit);
        stubMethod(network, 'nodePublicKey', exitNode.public_key, restoreExit);
        stubMethod(network, 'nodePrivateKey', exitNode.node_private_key, restoreExit);
        exitOffer = {
            end_date   : now() + 3600,
            broker_list: [
                {
                    address   : brokerAddress,
                    public_key: brokerKey.public_key
                }
            ]
        };
    });
    after(() => restoreExit.reverse().forEach(fn => fn()));
    beforeEach(() => vpnExit.sessionMap.clear());

    function sessionState() {
        const state = {
            session_id         : Math.random().toString(16).slice(2),
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
        vpnExit.sessionMap.set(state.session_id, state);
        return state;
    }

    function passBody(state, piece = pieceList[0], signer = holder, passCertificate = certificate) {
        return {
            pass               : {
                certificate: passCertificate,
                piece
            },
            challenge_signature: cloudPass.signHolderMessage({
                challenge: state.challenge,
                node_id  : exitNode.address_base
            }, signer.private_key)
        };
    }

    test('accepts a certificate of a broker its offer lists, with a piece and the holder\'s challenge signature', async() => {
        const state  = sessionState();
        const result = await vpnExit._authenticate(state, passBody(state));
        assert.equal(state.authenticated, true);
        assert.equal(state.pass_type, 'certificate');
        assert.equal(result.bytes_covered, PIECE_BYTES);
        vpnExit._closeSession(state, 'test');
    });

    test('refuses a certificate of a broker its offer does not list', async() => {
        const otherBroker = newKey();
        const foreign     = cloudPass.signCertificate(certificateBody({
            broker_address   : fullAddress(otherBroker),
            broker_public_key: otherBroker.public_key
        }), otherBroker.private_key);
        const state       = sessionState();
        await assert.rejects(vpnExit._authenticate(state, passBody(state, cloudPass.signPiece(foreign, 0, otherBroker.private_key), holder, foreign)), error => error === 'piece_invalid');
        const certificateKey = newKey();
        const foreignKeyed   = cloudPass.signCertificate(certificateBody({
            broker_address   : fullAddress(otherBroker),
            broker_public_key: otherBroker.public_key
        }, certificateKey), otherBroker.private_key);
        await assert.rejects(vpnExit._authenticate(state, passBody(state, cloudPass.signPiece(foreignKeyed, 0, certificateKey.private_key), holder, foreignKeyed)), error => error === 'broker_not_accepted');
    });

    test('refuses a forged piece, another holder\'s signature and a forged certificate', async() => {
        const state = sessionState();
        await assert.rejects(vpnExit._authenticate(state, passBody(state, cloudPass.signPiece(certificate, 0, brokerKey.private_key))), error => error === 'piece_invalid');
        await assert.rejects(vpnExit._authenticate(state, passBody(state, pieceList[0], attacker)), error => error === 'challenge_signature_invalid');
        await assert.rejects(vpnExit._authenticate(state, passBody(state, pieceList[0], holder, {...certificate, data_bytes: certificate.data_bytes * 2, piece_count: PIECE_COUNT * 2})),
            error => error === 'certificate_invalid_id');
        assert.equal(state.authenticated, false);
    });

    test('one connection per certificate', async() => {
        const first  = sessionState();
        await vpnExit._authenticate(first, passBody(first));
        const second = sessionState();
        await assert.rejects(vpnExit._authenticate(second, passBody(second)), error => error === 'pass_already_connected');
        vpnExit._closeSession(first, 'test');
    });

    test('each piece seen covers piece_bytes; the session closes when they are used', async() => {
        const state = sessionState();
        await vpnExit._authenticate(state, passBody(state, pieceList[1]));
        assert.equal(state.bytes_covered, 2 * PIECE_BYTES); // pieces 0 and 1 seen
        await vpnExit._onPiece(state, {piece: pieceList[2]});
        assert.equal(state.bytes_covered, 3 * PIECE_BYTES);
        await assert.rejects(vpnExit._onPiece(state, {piece: cloudPass.signPiece(certificate, 3, attacker.private_key)}), error => error === 'piece_invalid');
        // receipts keep the gap small while the data is used
        let sequence = 0;
        while (!state.closed) {
            vpnExit._countBytesSent(state, 256 * 1024);
            if (!state.closed) {
                const {receipt, signature} = receiptFor(certificate, exitNode.address_base, state.bytes_sent, ++sequence);
                await vpnExit._onCertificateReceipt(state, {receipt, signature});
            }
        }
        assert.equal(state.close_reason, 'data_used');
        assert.equal(state.bytes_sent, 3 * PIECE_BYTES);
    });

    test('accepts only receipts signed by the holder for this node, moving forward, within what was sent', async() => {
        const otherCertificate = await issueCertificate();
        const piece            = await issuePiece(otherCertificate, 0);
        const state            = sessionState();
        await vpnExit._authenticate(state, passBody(state, piece, holder, otherCertificate));
        vpnExit._countBytesSent(state, 1000);
        const tooMuch = receiptFor(otherCertificate, exitNode.address_base, 1001, 1);
        await assert.rejects(vpnExit._onCertificateReceipt(state, tooMuch), error => error === 'receipt_total_invalid');
        const forged = receiptFor(otherCertificate, exitNode.address_base, 1000, 1, attacker);
        await assert.rejects(vpnExit._onCertificateReceipt(state, forged), error => error === 'receipt_not_accepted');
        const otherNode = receiptFor(otherCertificate, otherExit.address_base, 1000, 1);
        await assert.rejects(vpnExit._onCertificateReceipt(state, otherNode), error => error === 'receipt_not_accepted');
        await vpnExit._onCertificateReceipt(state, receiptFor(otherCertificate, exitNode.address_base, 1000, 1));
        await assert.rejects(vpnExit._onCertificateReceipt(state, receiptFor(otherCertificate, exitNode.address_base, 1000, 1)), error => error === 'receipt_not_accepted');
        assert.equal(state.receipt_total_bytes, 1000);
        vpnExit._closeSession(state, 'test');
    });

    test('the unreceipted gap closes a broker pass session too', async() => {
        const otherCertificate = await issueCertificate();
        const piece            = await issuePiece(otherCertificate, 0);
        const state            = sessionState();
        stubMethod(config, 'VPN_RECEIPT_GAP_BYTES_MAX', 64 * 1024, restoreExit);
        await vpnExit._authenticate(state, passBody(state, piece, holder, otherCertificate));
        vpnExit._countBytesSent(state, 64 * 1024);
        assert.equal(state.closed, false);
        vpnExit._countBytesSent(state, 1);
        assert.equal(state.close_reason, 'unreceipted_gap');
    });

    test('reports its latest receipts to the broker in a signed report the broker accepts', async() => {
        const sentList = [];
        stubMethod(cloudOffer, 'listOffers', () => Promise.resolve([
            {
                node_id : brokerNode.address_base,
                endpoint: {node_address: '127.0.0.1', service_port: 1},
                broker  : {address: brokerAddress}
            }
        ]), restoreExit);
        stubMethod(cloudOffer, 'verifyOffer', () => ({valid: true}), restoreExit);
        stubMethod(nodeRequest, 'requestNodeService', (endpoint, nodeID, method, requestPath, body) => {
            sentList.push({nodeID, requestPath, body});
            return broker.addReport(body.report);
        }, restoreExit);
        stubMethod(vpnExit, '_getPayoutAddress', () => fullAddress(exitWallet), restoreExit);
        const unreported = await passRepository.listUnreportedVPNCertificate();
        assert.ok(unreported.length > 0);
        const receiptedBytes = (await passRepository.getVPNCertificate(certificate.certificate_id)).receipt_total_bytes;
        assert.ok(receiptedBytes > 0);
        await vpnExit.reportReceipts();
        assert.equal(sentList.length, 1);
        assert.equal(sentList[0].nodeID, brokerNode.address_base);
        assert.equal(sentList[0].requestPath, '/broker/report');
        assert.equal(sentList[0].body.report.node_id, exitNode.address_base);
        assert.deepEqual(await passRepository.listUnreportedVPNCertificate(), []);
        const stored = await brokerRepository.getReceipt(certificate.certificate_id, exitNode.address_base);
        assert.equal(stored.total_bytes, receiptedBytes);
    });
});

describe('user side: passes', () => {
    const restoreUser = [];
    after(() => restoreUser.reverse().forEach(fn => fn()));

    test('fetches the certificate once the payment is stable, then the first piece', async() => {
        const transactionID = newTransactionID();
        addPayment(transactionID, {is_stable: 0});
        await passRepository.addPass('pass-1', brokerAddress, holder.public_key, 'paid');
        await passRepository.updatePass('pass-1', {funding_transaction_id: transactionID});
        stubMethod(passWallet, 'getHolderPrivateKey', () => holder.private_key, restoreUser);
        stubMethod(passWallet, 'findBrokerOffer', () => Promise.resolve({node_id: brokerNode.address_base}), restoreUser);
        stubMethod(network, 'nodeID', brokerNode.address_base, restoreUser);
        let requestCount = 0;
        stubMethod(passWallet, '_brokerRequest', (offer, requestPath, body) => {
            requestCount++;
            if (requestCount === 2) {
                // the payment becomes stable
                paymentMap.get(transactionID).output_list[0].is_stable = 1;
            }
            return requestPath === '/broker/certificate' ? broker.issueCertificate(body) : broker.issuePiece(body);
        }, restoreUser);
        const timers = setTimeout;
        stubMethod(global, 'setTimeout', (fn, delay) => timers(fn, Math.min(delay, 5)), restoreUser);
        const pass = await passWallet.fetchCertificate('pass-1');
        global.setTimeout = timers;
        assert.equal(pass.status, 'active');
        assert.deepEqual(cloudPass.verifyCertificate(pass.certificate, now()), {valid: true});
        assert.deepEqual(pass.piece_list.map(piece => piece.piece_index), [0]);
        assert.equal(requestCount, 3); // not stable, certificate, piece 0
    });

    test('sends the next piece when half of the last one is used, and signs receipts the exit node accepts', async() => {
        const pass     = await passWallet.getPass('pass-1');
        const sentList = [];
        stubMethod(vpnClient, '_request', (session, method, requestPath, body) => {
            sentList.push({requestPath, body});
            return Promise.resolve(requestPath === '/vpn/piece' ? {bytes_covered: 2 * PIECE_BYTES} : {});
        }, restoreUser);
        const state = {
            session_id         : 'client',
            session            : {},
            pass_type          : 'certificate',
            pass_id            : 'pass-1',
            node_id            : exitNode.address_base,
            certificate        : pass.certificate,
            piece              : pass.piece_list[0],
            bytes_covered      : PIECE_BYTES,
            bytes_received     : 0,
            receipt_total_bytes: 0,
            receipt_sequence   : 0,
            receipt_list       : [],
            closed             : false
        };
        vpnClient._countBytesReceived(state, PIECE_BYTES / 2 - 1);
        assert.ok(!sentList.some(entry => entry.requestPath === '/vpn/piece'));
        vpnClient._countBytesReceived(state, 2);
        await state.piece_request;
        const pieceEntry = sentList.find(entry => entry.requestPath === '/vpn/piece');
        assert.equal(pieceEntry.body.piece.piece_index, 1);
        assert.equal(cloudPass.isValidPiece(pass.certificate, pieceEntry.body.piece), true);
        assert.equal(state.bytes_covered, 2 * PIECE_BYTES);
        assert.equal(state.piece.piece_index, 1);

        vpnClient._sendReceipt(state); // a tunnel closed
        const receiptEntry = sentList.find(entry => entry.requestPath === '/vpn/receipt');
        assert.equal(receiptEntry.body.receipt.total_bytes, PIECE_BYTES / 2 + 1);
        assert.equal(receiptEntry.body.receipt.piece_index, 1);
        assert.equal(cloudPass.isValidReceipt(pass.certificate, receiptEntry.body.receipt, receiptEntry.body.signature, exitNode.address_base), true);
    });
});

function trialRequest(trialHolder, signer = trialHolder) {
    return {
        holder_public_key: trialHolder.public_key,
        signature        : cloudPass.signHolderMessage({
            trial_holder_public_key: trialHolder.public_key,
            broker_node_id         : brokerNode.address_base
        }, signer.private_key)
    };
}

async function issueTrial(trialHolder = newKey()) {
    const {certificate} = await asBroker(() => broker.issueTrialCertificate(trialRequest(trialHolder)));
    return certificate;
}

function issueTrialPiece(certificate, pieceIndex, trialHolder) {
    return asBroker(() => broker.issuePiece(pieceRequest(certificate, pieceIndex, trialHolder))).then(({piece}) => piece);
}

/**
 * a report of one exit node, received as if dated seconds later
 */
async function addReportLater(seconds, report) {
    const brokerNow = broker._now;
    broker._now     = () => brokerNow.call(broker) + seconds;
    try {
        return await broker.addReport(report);
    }
    finally {
        broker._now = brokerNow;
    }
}

const TRIAL_BYTES = 2 * PIECE_BYTES;

describe('broker: free trial', () => {
    const restoreTrial = [];
    const trialHolder  = newKey();
    before(() => {
        stubMethod(config, 'CLOUD_BROKER_TRIAL_ENABLED', true, restoreTrial);
        stubMethod(config, 'CLOUD_BROKER_TRIAL_DATA_BYTES', TRIAL_BYTES, restoreTrial);
    });
    after(() => restoreTrial.reverse().forEach(fn => fn()));

    test('by default a trial is 500 MB, one piece below the 1 GB pass piece', () => {
        const defaultBytes = 500 * 1024 * 1024;
        assert.equal(cloudPass.getTrialPieceBytes(defaultBytes, GB), defaultBytes);
        assert.equal(cloudPass.isValidTrialSize(defaultBytes, GB), true);
        // larger trials are pieces of the pass piece size
        assert.equal(cloudPass.getTrialPieceBytes(2 * GB, GB), GB);
        assert.equal(cloudPass.isValidTrialSize(1.5 * GB, GB), false);
    });

    test('issues a trial certificate without payment, marked as a trial, once per holder key', async() => {
        const {certificate} = await broker.issueTrialCertificate(trialRequest(trialHolder));
        assert.deepEqual(cloudPass.verifyCertificate(certificate, now()), {valid: true});
        assert.equal(certificate.trial, true);
        assert.equal(cloudPass.isTrialCertificate(certificate), true);
        assert.equal(certificate.holder_public_key, trialHolder.public_key);
        assert.equal(certificate.funding_transaction_id, cloudPass.getTrialID(trialHolder.public_key));
        assert.equal(certificate.data_bytes, TRIAL_BYTES);
        assert.equal(certificate.piece_bytes, PIECE_BYTES);
        assert.equal(certificate.piece_count, 2);
        const record = await brokerRepository.getCertificate(certificate.certificate_id);
        assert.equal(record.is_trial, 1);
        assert.equal(record.payment_amount, null);
        // the same key gets the same certificate again
        assert.deepEqual((await broker.issueTrialCertificate(trialRequest(trialHolder))).certificate, certificate);
        // its pieces are issued like a pass's
        assert.equal(cloudPass.isValidPiece(certificate, (await broker.issuePiece(pieceRequest(certificate, 0, trialHolder))).piece), true);
    });

    test('a pass certificate is not a trial and stores what its payment paid', async() => {
        const transactionID = newTransactionID();
        addPayment(transactionID, {amount: 6000000});
        const {certificate} = await broker.issueCertificate(certificateRequest(transactionID));
        assert.equal(cloudPass.isTrialCertificate(certificate), false);
        assert.equal(certificate.trial, undefined);
        const record = await brokerRepository.getCertificate(certificate.certificate_id);
        assert.equal(record.is_trial, 0);
        assert.equal(record.payment_amount, 6000000);
    });

    test('refuses a trial request not signed by the holder key, and a trial when the broker offers none', async() => {
        await assert.rejects(broker.issueTrialCertificate(trialRequest(newKey(), attacker)), error => error === 'trial_request_invalid');
        const restoreOff = [];
        stubMethod(config, 'CLOUD_BROKER_TRIAL_ENABLED', false, restoreOff);
        try {
            await assert.rejects(broker.issueTrialCertificate(trialRequest(newKey())), error => error === 'trial_not_offered');
        }
        finally {
            restoreOff.forEach(fn => fn());
        }
    });

    test('refuses a certificate marked trial other than true', () => {
        const body = certificateBody({trial: false});
        assert.equal(cloudPass.verifyCertificate(cloudPass.signCertificate(body, brokerKey.private_key), now()).reason, 'certificate_invalid_format');
        assert.equal(cloudPass.verifyCertificate(cloudPass.signCertificate(certificateBody({trial: 1}), brokerKey.private_key), now()).reason, 'certificate_invalid_format');
    });

    test('with CLOUD_BROKER_TRIAL_ENABLED null, tangled\'s default broker offers the trial and other brokers do not', () => {
        const restoreDefault = [];
        stubMethod(config, 'CLOUD_BROKER_TRIAL_ENABLED', null, restoreDefault);
        try {
            stubMethod(config, 'CLOUD_BROKER_LIST', [{address: brokerAddress, public_key: brokerKey.public_key}], restoreDefault);
            assert.equal(broker.isTrialOffered(), true);
            stubMethod(config, 'CLOUD_BROKER_LIST', [{address: fullAddress(attacker), public_key: attacker.public_key}], restoreDefault);
            assert.equal(broker.isTrialOffered(), false);
            stubMethod(config, 'CLOUD_BROKER_LIST', [], restoreDefault);
            assert.equal(broker.isTrialOffered(), false);
        }
        finally {
            restoreDefault.reverse().forEach(fn => fn());
        }
    });

    test('the terms carry trial_data_bytes only when the trial is offered, and verify either way', () => {
        const terms = broker.getTerms();
        assert.equal(terms.trial_data_bytes, TRIAL_BYTES);
        assert.equal(cloudPass.isValidBrokerTerms(terms, brokerNode.address_base), true);
        const restoreOff = [];
        stubMethod(config, 'CLOUD_BROKER_TRIAL_ENABLED', false, restoreOff);
        try {
            const termsWithoutTrial = broker.getTerms();
            assert.equal('trial_data_bytes' in termsWithoutTrial, false);
            assert.equal(cloudPass.isValidBrokerTerms(termsWithoutTrial, brokerNode.address_base), true);
        }
        finally {
            restoreOff.forEach(fn => fn());
        }
        // a trial size that is not whole pieces is refused
        const {signature, ...body} = terms;
        assert.equal(cloudPass.isValidBrokerTerms(cloudPass.signBrokerTerms({...body, trial_data_bytes: PIECE_BYTES + 1}, brokerNode.address_base, brokerKey.private_key), brokerNode.address_base), false);
    });
});

describe('broker: trial payouts, the block list and the report', () => {
    const restoreOwn    = [];
    const exitA         = newKey();
    const exitB         = newKey();
    const sentList      = [];
    let ownRepository, passP1, passP2, passP3, trialT1, trialT2, trialT3;
    const trialHolderList = [newKey(), newKey(), newKey()];
    const rate            = 150000;
    const amountOf        = bytes => cloudPass.getPayoutAmount(bytes, rate);

    async function issuePass(amount) {
        const transactionID = newTransactionID();
        addPayment(transactionID, {amount});
        return (await broker.issueCertificate(certificateRequest(transactionID))).certificate;
    }

    before(async() => {
        // a broker of its own, so the figures are exact
        const database   = await openCloudDatabase();
        ownRepository = new CloudBrokerRepository(database);
        restoreOwn.push(stubRepositories({
            cloud_broker: ownRepository,
            cloud_pass  : new CloudPassRepository(database),
            cloud_notice: new CloudNoticeRepository(database),
            transaction : {
                getTransactionObject : transactionID => paymentMap.has(transactionID) ? Promise.resolve(paymentMap.get(transactionID).transaction) : Promise.reject('transaction_not_found'),
                listTransactionOutput: where => Promise.resolve((paymentMap.get(where['transaction_output.transaction_id'])?.output_list || [])
                    .filter(output => output.address === where['transaction_output.address']))
            }
        }));
        stubMethod(config, 'CLOUD_BROKER_TRIAL_ENABLED', true, restoreOwn);
        stubMethod(config, 'CLOUD_BROKER_TRIAL_DATA_BYTES', TRIAL_BYTES, restoreOwn);
        stubMethod(wallet, 'addTransaction', (outputList, fee) => {
            sentList.push({outputList, fee});
            return Promise.resolve([{transaction_id: `${sentList.length}`.padStart(50, 'X')}]);
        }, restoreOwn);
        stubMethod(broker, 'server', {}, restoreOwn);

        passP1 = await issuePass(5000000);
        passP2 = await issuePass(6000000);
        passP3 = await issuePass(5000000);
        // a pass issued before the payment amount was stored
        await ownRepository._run('UPDATE cloud_broker_certificate SET payment_amount = NULL WHERE certificate_id = ?', [passP3.certificate_id]);
        trialT1 = await issueTrial(trialHolderList[0]);
        trialT2 = await issueTrial(trialHolderList[1]);
        trialT3 = await issueTrial(trialHolderList[2]);
    });
    after(() => {
        broker.server = null;
        restoreOwn.reverse().forEach(fn => fn());
    });

    function lastPayout() {
        return sentList[sentList.length - 1];
    }

    test('pays exit nodes for trial receipts in the normal payout, recorded as trial', async() => {
        // exit A carries both trials in full; exit B carries a pass and,
        // later, trial data that the trial no longer covers
        await broker.addReport(hostReport(exitA, [
            receiptFor(trialT1, exitA.address_base, TRIAL_BYTES, 1, trialHolderList[0]),
            receiptFor(trialT2, exitA.address_base, TRIAL_BYTES, 1, trialHolderList[1])
        ]));
        await broker.addReport(hostReport(exitB, [receiptFor(passP1, exitB.address_base, PIECE_BYTES, 1)]));
        await addReportLater(10, hostReport(exitB, [receiptFor(trialT1, exitB.address_base, PIECE_BYTES, 1, trialHolderList[0])]));

        const hostList = _.keyBy(await broker.listHost(), 'node_id');
        assert.equal(hostList[exitA.address_base].amount_owed, 2 * amountOf(TRIAL_BYTES));
        assert.equal(hostList[exitA.address_base].amount_owed_trial, 2 * amountOf(TRIAL_BYTES));
        assert.equal(hostList[exitB.address_base].amount_owed, amountOf(PIECE_BYTES));
        assert.equal(hostList[exitB.address_base].amount_owed_trial, 0);

        await broker.doPayout();
        assert.equal(sentList.length, 1);
        assert.deepEqual(_.sortBy(lastPayout().outputList.map(output => output.amount)), _.sortBy([2 * amountOf(TRIAL_BYTES), amountOf(PIECE_BYTES)]));
        const payoutList = _.keyBy(await ownRepository.listPayout(), 'node_id');
        assert.equal(payoutList[exitA.address_base].amount, 2 * amountOf(TRIAL_BYTES));
        assert.equal(payoutList[exitA.address_base].amount_trial, 2 * amountOf(TRIAL_BYTES));
        assert.equal(payoutList[exitB.address_base].amount_trial, 0);
        assert.ok((await broker.listHost()).every(host => host.amount_owed === 0));
    });

    test('refuses a block list that is not node ids', async() => {
        await assert.rejects(broker.setTrialBlockList('x'), error => error === 'node_id_list_invalid');
        await assert.rejects(broker.setTrialBlockList([exitA.address_base, 'not a node id']), error => error === 'node_id_list_invalid');
        assert.deepEqual(await broker.listTrialBlock(), []);
    });

    test('holds back the trial receipts of an exit node on the block list, its pass receipts still paid', async() => {
        const trialBlockList = await broker.setTrialBlockList([exitA.address_base, exitA.address_base]);
        assert.deepEqual(trialBlockList.map(entry => entry.node_id), [exitA.address_base]);
        await broker.addReport(hostReport(exitA, [
            receiptFor(trialT3, exitA.address_base, PIECE_BYTES, 1, trialHolderList[2]),
            receiptFor(passP2, exitA.address_base, PIECE_BYTES, 1)
        ]));
        const hostA = _.find(await broker.listHost(), {node_id: exitA.address_base});
        assert.equal(hostA.is_trial_blocked, true);
        assert.equal(hostA.amount_owed, amountOf(PIECE_BYTES));
        assert.equal(hostA.amount_owed_trial, 0);
        assert.equal(hostA.amount_withheld_trial, amountOf(PIECE_BYTES));
    });

    test('the report shows what passes sold and what trials and passes cost, per exit node, from the records', async() => {
        const report = await broker.getReport();
        assert.equal(report.broker_address, brokerAddress);
        assert.deepEqual(report.trial, {offered: true, data_bytes: TRIAL_BYTES});
        // earned: what the three payments paid, one read from its payment
        assert.deepEqual(report.earned, {
            pass_count                  : 3,
            pass_receipted_count        : 2,
            pass_payment_amount         : 5000000 + 6000000 + 5000000,
            pass_payment_not_found_count: 0
        });
        assert.deepEqual(report.spent.trial, {
            certificate_count          : 3,
            certificate_receipted_count: 3,
            bytes_receipted            : 2 * TRIAL_BYTES + PIECE_BYTES + PIECE_BYTES,
            bytes_payable              : 2 * TRIAL_BYTES + PIECE_BYTES,
            amount_earned              : 2 * amountOf(TRIAL_BYTES) + amountOf(PIECE_BYTES),
            amount_paid                : 2 * amountOf(TRIAL_BYTES),
            amount_owed                : 0,
            amount_withheld            : amountOf(PIECE_BYTES)
        });
        assert.deepEqual(report.spent.pass, {
            bytes_receipted: 2 * PIECE_BYTES,
            bytes_payable  : 2 * PIECE_BYTES,
            amount_earned  : 2 * amountOf(PIECE_BYTES),
            amount_paid    : amountOf(PIECE_BYTES),
            amount_owed    : amountOf(PIECE_BYTES)
        });
        assert.equal(report.spent.amount_paid, 2 * amountOf(TRIAL_BYTES) + amountOf(PIECE_BYTES));
        assert.equal(report.spent.payout_transaction_count, 1);
        assert.equal(report.net_amount, 16000000 - 2 * amountOf(TRIAL_BYTES) - amountOf(PIECE_BYTES));

        // the exit node carrying the most trial data comes first
        const [hostA, hostB] = report.host_list;
        assert.equal(hostA.node_id, exitA.address_base);
        assert.equal(hostA.is_trial_blocked, true);
        assert.ok(hostA.trial_block_date > 0);
        assert.equal(hostA.trial.certificate_count, 3);
        assert.equal(hostA.trial.bytes_receipted, 2 * TRIAL_BYTES + PIECE_BYTES);
        assert.equal(hostA.trial.amount_paid, 2 * amountOf(TRIAL_BYTES));
        assert.equal(hostA.trial.amount_withheld, amountOf(PIECE_BYTES));
        assert.equal(hostA.pass.amount_owed, amountOf(PIECE_BYTES));
        assert.equal(hostA.payout_count, 1);
        assert.equal(hostB.node_id, exitB.address_base);
        assert.equal(hostB.is_trial_blocked, false);
        assert.equal(hostB.trial.bytes_receipted, PIECE_BYTES);
        // the trial was used up at exit A first: exit B's trial bytes earn
        // nothing
        assert.equal(hostB.trial.bytes_payable, 0);
        assert.equal(hostB.trial.amount_earned, 0);
        assert.equal(hostB.pass.amount_paid, amountOf(PIECE_BYTES));
        assert.equal(hostB.amount_paid, amountOf(PIECE_BYTES));
    });

    test('pays a blocked exit node its pass receipts only, and what was held back once it is off the list', async() => {
        await broker.doPayout();
        assert.equal(sentList.length, 2);
        assert.deepEqual(lastPayout().outputList.map(output => output.amount), [amountOf(PIECE_BYTES)]);
        const payoutA = _.filter(await ownRepository.listPayout(), {node_id: exitA.address_base});
        assert.deepEqual(_.sortBy(payoutA.map(payout => payout.amount_trial)), [0, 2 * amountOf(TRIAL_BYTES)]);

        await broker.setTrialBlockList([]);
        await broker.doPayout();
        assert.equal(sentList.length, 3);
        assert.deepEqual(lastPayout().outputList.map(output => output.amount), [amountOf(PIECE_BYTES)]);
        const report = await broker.getReport();
        assert.equal(report.spent.trial.amount_paid, 2 * amountOf(TRIAL_BYTES) + amountOf(PIECE_BYTES));
        assert.equal(report.spent.trial.amount_withheld, 0);
        assert.equal(report.spent.payout_transaction_count, 3);
        assert.ok((await broker.listHost()).every(host => host.amount_owed === 0));
    });
});

describe('exit node: trial certificates', () => {
    const restoreExit = [];
    const trialHolder = newKey();
    let trialCertificate, trialPiece, passCertificate, passPiece, statusRequestList, isBrokerReachable;

    before(async() => {
        stubMethod(config, 'CLOUD_BROKER_TRIAL_ENABLED', true, restoreExit);
        stubMethod(config, 'CLOUD_BROKER_TRIAL_DATA_BYTES', TRIAL_BYTES, restoreExit);
        trialCertificate = await issueTrial(trialHolder);
        trialPiece       = await issueTrialPiece(trialCertificate, 0, trialHolder);
        passCertificate  = await issueCertificate();
        passPiece        = await issuePiece(passCertificate, 0);
        stubMethod(network, 'nodeID', exitNode.address_base, restoreExit);
        stubMethod(network, 'nodePublicKey', exitNode.public_key, restoreExit);
        stubMethod(network, 'nodePrivateKey', exitNode.node_private_key, restoreExit);
        exitOffer = {
            end_date   : now() + 3600,
            broker_list: [
                {
                    address   : brokerAddress,
                    public_key: brokerKey.public_key
                }
            ]
        };
        stubMethod(cloudOffer, 'listOffers', () => Promise.resolve([
            {
                node_id : brokerNode.address_base,
                endpoint: {node_address: '127.0.0.1', service_port: 1},
                broker  : {address: brokerAddress}
            }
        ]), restoreExit);
        stubMethod(cloudOffer, 'verifyOffer', () => ({valid: true}), restoreExit);
        stubMethod(nodeRequest, 'requestNodeService', (endpoint, nodeID, method, requestPath, body) => {
            statusRequestList.push({nodeID, requestPath, body});
            return isBrokerReachable ? broker.getTrialStatus(body) : Promise.reject('node_unreachable');
        }, restoreExit);
    });
    after(async() => {
        await asBroker(() => broker.setTrialBlockList([]));
        restoreExit.reverse().forEach(fn => fn());
    });
    beforeEach(async() => {
        await asBroker(() => broker.setTrialBlockList([]));
        vpnExit.sessionMap.clear();
        vpnExit.trialStatusMap.clear();
        statusRequestList = [];
        isBrokerReachable = true;
    });

    function sessionState() {
        const state = {
            session_id         : Math.random().toString(16).slice(2),
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
        vpnExit.sessionMap.set(state.session_id, state);
        return state;
    }

    function passBody(state, certificate, piece, signer) {
        return {
            pass               : {
                certificate,
                piece
            },
            challenge_signature: cloudPass.signHolderMessage({
                challenge: state.challenge,
                node_id  : exitNode.address_base
            }, signer.private_key)
        };
    }

    test('accepts a trial certificate when the broker says its trial extends to this node, asking once', async() => {
        const state = sessionState();
        await vpnExit._authenticate(state, passBody(state, trialCertificate, trialPiece, trialHolder));
        assert.equal(state.authenticated, true);
        assert.equal(state.bytes_covered, PIECE_BYTES);
        assert.equal(statusRequestList.length, 1);
        assert.equal(statusRequestList[0].nodeID, brokerNode.address_base);
        assert.equal(statusRequestList[0].requestPath, '/broker/trial/status');
        vpnExit._closeSession(state, 'test');
        const second = sessionState();
        await vpnExit._authenticate(second, passBody(second, trialCertificate, trialPiece, trialHolder));
        assert.equal(statusRequestList.length, 1);
        vpnExit._closeSession(second, 'test');
    });

    test('a blocked exit node refuses the trial certificate and still accepts passes', async() => {
        await asBroker(() => broker.setTrialBlockList([exitNode.address_base]));
        const state = sessionState();
        await assert.rejects(vpnExit._authenticate(state, passBody(state, trialCertificate, trialPiece, trialHolder)), error => error === 'trial_not_extended');
        assert.equal(state.authenticated, false);
        const passState = sessionState();
        await vpnExit._authenticate(passState, passBody(passState, passCertificate, passPiece, holder));
        assert.equal(passState.authenticated, true);
        vpnExit._closeSession(passState, 'test');
        // the broker was asked about the trial only
        assert.equal(statusRequestList.length, 1);
    });

    test('keeps the broker\'s answer for CLOUD_BROKER_REPORT_INTERVAL', async() => {
        await asBroker(() => broker.setTrialBlockList([exitNode.address_base]));
        const state = sessionState();
        await assert.rejects(vpnExit._authenticate(state, passBody(state, trialCertificate, trialPiece, trialHolder)), error => error === 'trial_not_extended');
        await asBroker(() => broker.setTrialBlockList([]));
        await assert.rejects(vpnExit._authenticate(state, passBody(state, trialCertificate, trialPiece, trialHolder)), error => error === 'trial_not_extended');
        const exitNow = vpnExit._now;
        vpnExit._now  = () => exitNow.call(vpnExit) + config.CLOUD_BROKER_REPORT_INTERVAL;
        try {
            await vpnExit._authenticate(state, passBody(state, trialCertificate, trialPiece, trialHolder));
        }
        finally {
            vpnExit._now = exitNow;
        }
        assert.equal(state.authenticated, true);
        assert.equal(statusRequestList.length, 2);
        vpnExit._closeSession(state, 'test');
    });

    test('accepts the trial when the broker cannot be asked: the broker decides what it pays', async() => {
        await asBroker(() => broker.setTrialBlockList([exitNode.address_base]));
        isBrokerReachable = false;
        const state       = sessionState();
        await vpnExit._authenticate(state, passBody(state, trialCertificate, trialPiece, trialHolder));
        assert.equal(state.authenticated, true);
        assert.equal(vpnExit.trialStatusMap.size, 0);
        vpnExit._closeSession(state, 'test');
    });

    test('the broker answers only a status request signed by the node key, dated now', async() => {
        const request = cloudPass.signNodeRequest(exitNode.address_base, exitNode.public_key, now(), exitNode.node_private_key);
        assert.deepEqual(await broker.getTrialStatus(request), {trial_offered: true, trial_extended: true});
        await assert.rejects(broker.getTrialStatus(cloudPass.signNodeRequest(exitNode.address_base, exitNode.public_key, now(), attacker.node_private_key)),
            error => error === 'trial_status_request_invalid');
        await assert.rejects(broker.getTrialStatus(cloudPass.signNodeRequest(exitNode.address_base, exitNode.public_key, now() - 3600, exitNode.node_private_key)),
            error => error === 'trial_status_request_invalid');
        await assert.rejects(broker.getTrialStatus({...request, node_id: otherExit.address_base}), error => error === 'trial_status_request_invalid');
    });
});

describe('user side: trial passes', () => {
    const restoreUser = [];
    const trialHolder = newKey();
    let requestList, brokerOffer;

    before(() => {
        stubMethod(config, 'CLOUD_BROKER_TRIAL_ENABLED', true, restoreUser);
        stubMethod(config, 'CLOUD_BROKER_TRIAL_DATA_BYTES', TRIAL_BYTES, restoreUser);
        stubMethod(cloudVersion, 'isCloudEnabled', () => true, restoreUser);
        stubMethod(passWallet, 'getHolderPrivateKey', () => trialHolder.private_key, restoreUser);
        stubMethod(passWallet, 'findBrokerOffer', () => Promise.resolve(brokerOffer), restoreUser);
        stubMethod(network, 'nodeID', brokerNode.address_base, restoreUser);
        stubMethod(passWallet, '_brokerRequest', (offer, requestPath, body) => {
            requestList.push(requestPath);
            return requestPath === '/broker/trial' ? broker.issueTrialCertificate(body) : broker.issuePiece(body);
        }, restoreUser);
    });
    after(() => restoreUser.reverse().forEach(fn => fn()));
    beforeEach(() => {
        requestList = [];
        brokerOffer = {
            node_id: brokerNode.address_base,
            broker : broker.getTerms()
        };
    });

    test('refuses a trial from a broker whose terms offer none', async() => {
        brokerOffer.broker = _.omit(brokerOffer.broker, ['trial_data_bytes']);
        await assert.rejects(passWallet.requestTrial(brokerAddress), error => error === 'trial_not_offered');
        assert.deepEqual(requestList, []);
        assert.equal((await passWallet.getPass(passWallet.getTrialPassID(brokerAddress))).status, 'failed');
    });

    test('gets the trial certificate and its first piece, then keeps the active trial', async() => {
        const pass = await passWallet.requestTrial(brokerAddress);
        assert.equal(pass.pass_id, passWallet.getTrialPassID(brokerAddress));
        assert.equal(pass.status, 'active');
        assert.equal(pass.certificate.trial, true);
        assert.equal(pass.certificate.holder_public_key, trialHolder.public_key);
        assert.deepEqual(pass.piece_list.map(piece => piece.piece_index), [0]);
        assert.deepEqual(requestList, ['/broker/trial', '/broker/piece']);
        assert.deepEqual(await passWallet.requestTrial(brokerAddress), pass);
        assert.equal(requestList.length, 2);
    });
});

describe('node services over tls', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'node-certificate-'));
    const restoreTLS = [];
    let server, port, nodeID;

    before(async() => {
        stubMethod(config, 'NODE_KEY_PATH', path.join(folder, 'node.json'), restoreTLS);
        stubMethod(config, 'NODE_CERTIFICATE_KEY_PATH', path.join(folder, 'node_certificate_key.pem'), restoreTLS);
        stubMethod(config, 'NODE_CERTIFICATE_PATH', path.join(folder, 'node_certificate.pem'), restoreTLS);
        const certificate = await walletUtils.loadNodeKeyAndCertificate();
        nodeID            = walletUtils.getNodeIdFromCertificate(certificate.certificate_pem, 'pem');
        server            = https.createServer({
            key : certificate.certificate_private_key_pem,
            cert: certificate.certificate_pem
        }, (request, response) => nodeRequest.readJSONBody(request, 1024)
                                              .then(body => nodeRequest.sendJSON(response, 200, {echo: body}))
                                              .catch(error => nodeRequest.sendJSON(response, 403, {error})));
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        port = server.address().port;
    });
    after(() => {
        server && server.close();
        restoreTLS.reverse().forEach(fn => fn());
        fs.rmSync(folder, {
            recursive: true,
            force    : true
        });
    });

    test('reaches a node whose certificate carries the expected node id', async() => {
        assert.ok(nodeID);
        const result = await nodeRequest.requestNodeService({node_address: '127.0.0.1', service_port: port}, nodeID, 'POST', '/x', {a: 1});
        assert.deepEqual(result, {echo: {a: 1}});
    });

    test('refuses a node whose certificate carries another node id', async() => {
        await assert.rejects(nodeRequest.requestNodeService({node_address: '127.0.0.1', service_port: port}, attacker.address_base, 'POST', '/x', {a: 1}),
            error => error === 'node_certificate_invalid');
    });

    test('a request body above the limit is refused', async() => {
        await assert.rejects(nodeRequest.requestNodeService({node_address: '127.0.0.1', service_port: port}, nodeID, 'POST', '/x', {a: 'x'.repeat(2000)}),
            error => typeof error === 'string');
    });
});
