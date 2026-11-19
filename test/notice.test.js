import {after, before, beforeEach, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import config from '../core/config/config';
import network from '../net/network';
import wallet from '../core/wallet/wallet';
import walletUtils from '../core/wallet/wallet-utils';
import objectHash from '../core/crypto/object-hash';
import cloudNotice, {CLOUD_NOTICE_VERSION} from '../net/cloud-notice';
import cloudPass, {CLOUD_PASS_VERSION} from '../net/broker/cloud-pass';
import vpnExit from '../net/vpn/vpn-exit';
import CloudNoticeRepository from '../database/repositories/cloud-notice';
import CloudPassRepository from '../database/repositories/cloud-pass';
import {fullAddress, newKey, now, openCloudDatabase, stubRepositories, VERSION} from './helper';

const brokerKey      = newKey();
const certificateKey = newKey();
const holder         = newKey();
const attacker       = newKey();
const reporterList   = [newKey(), newKey(), newKey(), newKey()];
const DAY            = 24 * 3600;

const certificate = cloudPass.signCertificate({
    version               : CLOUD_PASS_VERSION,
    broker_address        : fullAddress(brokerKey),
    broker_public_key     : brokerKey.public_key,
    certificate_public_key: certificateKey.public_key,
    holder_public_key     : holder.public_key,
    funding_transaction_id: 'F'.repeat(50),
    data_bytes            : 4 * 1024 * 1024,
    piece_bytes           : 1024 * 1024,
    piece_count           : 4,
    start_date            : now() - 60,
    end_date              : now() + 7 * DAY
}, brokerKey.private_key);

function receiptFor(node, signer = holder, certificateValue = certificate) {
    const receipt = {
        version       : CLOUD_PASS_VERSION,
        certificate_id: certificateValue.certificate_id,
        node_id       : node.address_base,
        piece_index   : 0,
        total_bytes   : 1000,
        sequence      : 1,
        receipt_date  : now()
    };
    return {
        receipt,
        receipt_signature: cloudPass.signReceipt(receipt, signer.private_key)
    };
}

let anchorCount = 0;

/**
 * a notice signed by node, as cloudNotice publishes it
 */
function makeNotice(node, fields, {anchorID, createDate = now(), duration = DAY, signer = node} = {}) {
    const body     = {
        version        : CLOUD_NOTICE_VERSION,
        node_id        : node.address_base,
        node_public_key: node.public_key,
        create_date    : createDate,
        end_date       : createDate + duration,
        ...fields
    };
    const anchored = {
        ...body,
        notice_id            : objectHash.getCHash288(body),
        anchor_transaction_id: anchorID || `${++anchorCount}`.padStart(50, 'A')
    };
    return {
        ...anchored,
        signature: walletUtils.signMessage(signer.node_private_key, anchored)
    };
}

function userNotice(node, overrides = {}, options) {
    return makeNotice(node, {
        notice_type: 'user',
        certificate,
        pattern    : 'unreceipted_gap',
        numbers    : {
            bytes_sent     : 60 * 1024 * 1024,
            bytes_receipted: 1000
        },
        ...receiptFor(node),
        ...overrides
    }, options);
}

function domainNotice(node, domain = 'malware.example.com', options) {
    return makeNotice(node, {
        notice_type: 'domain',
        domain,
        threat_type: 'malware'
    }, options);
}

const anchorMap = new Map();

/**
 * a stable anchor transaction listing the notice ids, as the transaction
 * repository returns it (the date as a Date)
 */
function anchor(noticeList, {transactionDate = now(), isStable = 1, version = VERSION.transaction_signed, listed = true} = {}) {
    const anchorID = noticeList[0].anchor_transaction_id;
    anchorMap.set(anchorID, {
        transaction_id              : anchorID,
        version,
        transaction_date            : new Date(transactionDate * 1000),
        is_stable                   : isStable,
        transaction_output_attribute: {transaction_output_metadata: {cloud_notice: listed ? noticeList.map(notice => notice.notice_id) : ['x']}}
    });
}

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

let noticeRepository, passRepository, requestedList;

before(async() => {
    const database   = await openCloudDatabase();
    noticeRepository = new CloudNoticeRepository(database);
    passRepository   = new CloudPassRepository(database);
    requestedList    = [];
    restore.push(stubRepositories({
        cloud_notice: noticeRepository,
        cloud_pass  : passRepository,
        transaction : {
            getTransactionObject: transactionID => anchorMap.has(transactionID) ? Promise.resolve(anchorMap.get(transactionID)) : Promise.reject('transaction_not_found')
        },
        cloud_offer : {
            getOffer: () => Promise.resolve({
                end_date   : now() + 3600,
                broker_list: [{address: fullAddress(brokerKey), public_key: brokerKey.public_key}]
            })
        }
    }));
    stubMethod(wallet, 'requestTransactionFromNetwork', transactionID => requestedList.push(transactionID));
    stubMethod(config, 'CLOUD_NOTICE_THRESHOLD', 3);
    stubMethod(config, 'CLOUD_NOTICE_HOST_AGE_MIN', 7 * DAY);
    stubMethod(network, 'registeredClients', []);
});
after(() => restore.reverse().forEach(fn => fn()));
beforeEach(() => cloudNotice._countCache.clear());

/**
 * records that this node saw a host offer from node daysAgo days ago
 */
function seenAsHost(node, daysAgo) {
    return noticeRepository.recordHost(node.address_base, now() - daysAgo * DAY);
}

describe('notice format', () => {
    test('a user notice and a domain notice signed by the reporting node verify', () => {
        assert.deepEqual(cloudNotice.verifyNotice(userNotice(reporterList[0])), {valid: true});
        assert.deepEqual(cloudNotice.verifyNotice(domainNotice(reporterList[0])), {valid: true});
    });

    test('a user notice carries no site: only the listed numbers are allowed', () => {
        assert.deepEqual(cloudNotice.verifyNotice(userNotice(reporterList[0], {numbers: {bytes_sent: 1, site: 7}})), {
            valid : false,
            reason: 'notice_invalid_pattern'
        });
        assert.equal(cloudNotice.verifyNotice(userNotice(reporterList[0], {numbers: {bytes_sent: 'example.com'}})).reason, 'notice_invalid_pattern');
        assert.equal(cloudNotice.verifyNotice(userNotice(reporterList[0], {site_list: ['example.com']})).reason, 'notice_invalid_format');
        assert.equal(cloudNotice.verifyNotice(userNotice(reporterList[0], {pattern: 'visited_example_com'})).reason, 'notice_invalid_pattern');
    });

    for (const [name, build, reason] of [
        ['changed after signing', () => ({...userNotice(reporterList[0]), pattern: 'private_address_probe'}), 'notice_invalid_id'],
        ['re-anchored after signing', () => ({...domainNotice(reporterList[0]), anchor_transaction_id: 'B'.repeat(50)}), 'notice_invalid_signature'],
        ['signed by another node in its name', () => domainNotice(reporterList[0], 'malware.example.com', {signer: attacker}), 'notice_invalid_signature'],
        ['from a node that did not carry the certificate (receipt for another node)', () => userNotice(reporterList[0], receiptFor(reporterList[1])), 'notice_receipt_invalid'],
        ['with a receipt not signed by the holder', () => userNotice(reporterList[0], receiptFor(reporterList[0], attacker)), 'notice_receipt_invalid'],
        ['naming a forged certificate', () => userNotice(reporterList[0], {certificate: {...certificate, holder_public_key: attacker.public_key}}), 'notice_certificate_invalid_id'],
        ['past its expiry', () => domainNotice(reporterList[0], 'malware.example.com', {createDate: now() - 2 * DAY}), 'notice_expired'],
        ['expiring after CLOUD_NOTICE_DURATION_MAX', () => domainNotice(reporterList[0], 'malware.example.com', {duration: config.CLOUD_NOTICE_DURATION_MAX + 1}), 'notice_invalid_date'],
        ['for a name that is not a domain', () => domainNotice(reporterList[0], 'localhost'), 'notice_invalid_domain'],
        ['for an upper case domain', () => domainNotice(reporterList[0], 'Malware.example.com'), 'notice_invalid_domain']
    ]) {
        test(`refuses a notice ${name}`, () => assert.equal(cloudNotice.verifyNotice(build()).reason, reason));
    }

    test('refuses a domain notice of an unknown threat type', () => {
        assert.equal(cloudNotice.verifyNotice(makeNotice(reporterList[0], {notice_type: 'domain', domain: 'a.example.com', threat_type: 'politics'})).reason, 'notice_invalid_domain');
    });

    test('a user notice still verifies after its certificate ended', () => {
        const ended = cloudPass.signCertificate({...cloudPass.getCertificateBody(certificate), start_date: now() - 9 * DAY, end_date: now() - 2 * DAY}, brokerKey.private_key);
        assert.deepEqual(cloudNotice.verifyNotice(userNotice(reporterList[0], {certificate: ended, ...receiptFor(reporterList[0], holder, ended)})), {valid: true});
    });
});

describe('notice anchor', () => {
    test('the anchor is a stable version 3 transaction listing the notice; its date is the notice\'s time', async() => {
        const notice     = domainNotice(reporterList[0]);
        const anchorDate = now() + 5;
        anchor([notice], {transactionDate: anchorDate});
        assert.equal(await cloudNotice.checkAnchor(notice), anchorDate);
    });

    test('an anchor dated in seconds is read the same way', async() => {
        const notice = domainNotice(reporterList[0]);
        anchor([notice]);
        anchorMap.get(notice.anchor_transaction_id).transaction_date = now();
        assert.equal(await cloudNotice.checkAnchor(notice), now());
    });

    test('a missing anchor is asked of the network and the notice waits', async() => {
        const notice = domainNotice(reporterList[0]);
        assert.equal(await cloudNotice.checkAnchor(notice), null);
        assert.ok(requestedList.includes(notice.anchor_transaction_id));
    });

    test('a notice waits while its anchor is not stable', async() => {
        const notice = domainNotice(reporterList[0]);
        anchor([notice], {isStable: 0});
        assert.equal(await cloudNotice.checkAnchor(notice), null);
    });

    for (const [name, options] of [
        ['does not list the notice', {listed: false}],
        [`is version ${VERSION.transaction} (metadata not signed)`, {version: VERSION.transaction}],
        ['is dated before the notice was made', {transactionDate: now() - 3600}]
    ]) {
        test(`refuses an anchor that ${name}`, async() => {
            const notice = domainNotice(reporterList[0]);
            anchor([notice], options);
            await assert.rejects(cloudNotice.checkAnchor(notice), error => error === 'notice_anchor_invalid');
        });
    }
});

describe('thresholds and host age', () => {
    test(`a certificate counts as noticed once ${3} hosts of at least 7 days reported it`, async() => {
        const certificateA = cloudPass.signCertificate({...cloudPass.getCertificateBody(certificate), funding_transaction_id: 'G'.repeat(50)}, brokerKey.private_key);
        for (const node of reporterList.slice(0, 3)) {
            await seenAsHost(node, 10);
        }
        const notice = node => userNotice(node, {certificate: certificateA, ...receiptFor(node, holder, certificateA)});
        const first  = notice(reporterList[0]);
        anchor([first]);
        assert.equal(await cloudNotice.addNotice(first), true);
        assert.equal(await cloudNotice.isCertificateNoticed(certificateA.certificate_id), false);
        // the same node again counts once
        const again = notice(reporterList[0]);
        anchor([again]);
        await cloudNotice.addNotice(again);
        cloudNotice._countCache.clear();
        assert.equal(await cloudNotice.countReporters(`certificate:${certificateA.certificate_id}`), 1);
        for (const node of reporterList.slice(1, 3)) {
            const next = notice(node);
            anchor([next]);
            await cloudNotice.addNotice(next);
        }
        cloudNotice._countCache.clear();
        assert.equal(await cloudNotice.isCertificateNoticed(certificateA.certificate_id), true);
    });

    test('notices from nodes that have not been hosts for CLOUD_NOTICE_HOST_AGE_MIN do not count', async() => {
        const domain = 'young.example.com';
        const young  = [newKey(), newKey(), newKey()];
        await seenAsHost(young[0], 6);
        await seenAsHost(young[1], 1);
        // young[2] was never seen as a host
        for (const node of young) {
            const notice = domainNotice(node, domain);
            anchor([notice]);
            await cloudNotice.addNotice(notice);
        }
        assert.equal(await cloudNotice.countReporters(`domain:${domain}`), 0);
        assert.equal(await cloudNotice.isDomainNoticed(domain), false);
    });

    test('each node applies its own threshold', async() => {
        const domain = 'threshold.example.com';
        for (const node of reporterList.slice(0, 2)) {
            const notice = domainNotice(node, domain);
            anchor([notice]);
            await cloudNotice.addNotice(notice);
        }
        assert.equal(await cloudNotice.isDomainNoticed(domain), false);
        config.CLOUD_NOTICE_THRESHOLD = 2;
        try {
            assert.equal(await cloudNotice.isDomainNoticed(domain), true);
        }
        finally {
            config.CLOUD_NOTICE_THRESHOLD = 3;
        }
    });

    test('a noticed domain covers its subdomains, not its parent or neighbours', async() => {
        const domain = 'bad.example.org';
        for (const node of reporterList.slice(0, 3)) {
            const notice = domainNotice(node, domain);
            anchor([notice]);
            await cloudNotice.addNotice(notice);
        }
        assert.equal(await cloudNotice.isDomainNoticed('bad.example.org'), true);
        assert.equal(await cloudNotice.isDomainNoticed('cdn.bad.example.org'), true);
        assert.equal(await cloudNotice.isDomainNoticed('BAD.example.org.'), true);
        assert.equal(await cloudNotice.isDomainNoticed('example.org'), false);
        assert.equal(await cloudNotice.isDomainNoticed('notbad.example.org'), false);
    });

    test('notices waiting for their anchor do not count until it is stable', async() => {
        const domain = 'pending.example.net';
        const list   = reporterList.slice(0, 3).map(node => domainNotice(node, domain));
        for (const notice of list) {
            assert.equal(await cloudNotice.addNotice(notice), false);
        }
        assert.equal(await cloudNotice.countReporters(`domain:${domain}`), 0);
        list.forEach(notice => anchor([notice]));
        const sentList = [];
        network.registeredClients = [{
            nodeConnectionReady: true,
            send               : data => sentList.push(JSON.parse(data))
        }];
        try {
            const newList = await cloudNotice.checkPendingNoticeList();
            assert.deepEqual(new Set(newList.map(notice => notice.notice_id)), new Set(list.map(notice => notice.notice_id)));
            // and they spread once anchored
            assert.ok(sentList.some(payload => payload.type === 'cloud_notice_list' && payload.content.notice_list.length > 0));
        }
        finally {
            network.registeredClients = [];
        }
        cloudNotice._countCache.clear();
        assert.equal(await cloudNotice.countReporters(`domain:${domain}`), 3);
    });

    test('a host is recorded from its offers: first seen date kept, other services ignored', async() => {
        const node = newKey();
        await noticeRepository.recordHost(node.address_base, now() - 10 * DAY);
        await cloudNotice.recordHost({service: 'vpn_exit', node_id: node.address_base});
        await cloudNotice.recordHost({service: 'broker', node_id: attacker.address_base});
        const notice = domainNotice(node, 'recorded.example.com');
        anchor([notice]);
        await cloudNotice.addNotice(notice);
        const [row] = await noticeRepository.listNoticeWithHost('domain:recorded.example.com', now());
        assert.ok(now() - row.first_offer_date >= 10 * DAY - 5);
        assert.deepEqual(await noticeRepository.listNoticeWithHost('domain:none.example.com', now()), []);
    });
});

describe('spreading notices', () => {
    test('a new anchored notice is forwarded to the other peers; a forged one is not', async() => {
        const from    = {nodeConnectionReady: true, sent: [], send(data) { this.sent.push(JSON.parse(data)); }};
        const to      = {nodeConnectionReady: true, sent: [], send(data) { this.sent.push(JSON.parse(data)); }};
        network.registeredClients = [from, to];
        try {
            const notice = domainNotice(reporterList[3], 'spread.example.com');
            anchor([notice]);
            const forged = {...domainNotice(reporterList[3], 'spread.example.com'), domain: 'other.example.com'};
            cloudNotice._onNoticeList({notice_list: [notice, forged]}, from);
            await new Promise(resolve => setTimeout(resolve, 50));
            assert.equal(from.sent.length, 0);
            assert.deepEqual(to.sent.map(payload => payload.content.notice_list.map(item => item.notice_id)), [[notice.notice_id]]);
        }
        finally {
            network.registeredClients = [];
        }
    });
});

describe('publishing notices', () => {
    const reporter = reporterList[0];
    const restorePublish = [];
    before(() => {
        stubMethod(network, 'nodeID', reporter.address_base, restorePublish);
        stubMethod(network, 'nodePublicKey', reporter.public_key, restorePublish);
        stubMethod(network, 'nodePrivateKey', reporter.node_private_key, restorePublish);
        stubMethod(wallet, 'defaultKeyIdentifier', reporter.address_base, restorePublish);
    });
    after(() => restorePublish.reverse().forEach(fn => fn()));

    test('a domain notice is anchored by a transaction of this wallet listing its id', async() => {
        const sentList = [];
        stubMethod(wallet, 'addTransaction', (outputList, fee, srcOutputs, version, metadata) => {
            sentList.push({outputList, fee, version, metadata});
            return Promise.resolve([{transaction_id: 'C'.repeat(50)}]);
        }, restorePublish);
        const notice = await cloudNotice.publishDomainNotice('phishing.example.com', 'phishing', DAY);
        assert.deepEqual(cloudNotice.verifyNotice(notice), {valid: true});
        assert.equal(notice.anchor_transaction_id, 'C'.repeat(50));
        assert.equal(sentList.length, 1);
        assert.equal(sentList[0].version, VERSION.transaction_signed);
        assert.deepEqual(sentList[0].metadata, {cloud_notice: [notice.notice_id]});
        assert.equal(sentList[0].outputList[0].address_base, reporter.address_base);
        assert.ok((await noticeRepository.getNotice(notice.notice_id)).status === 0);
    });

    test('a notice that would not verify is not anchored', async() => {
        let called = false;
        stubMethod(wallet, 'addTransaction', () => {
            called = true;
            return Promise.resolve([{transaction_id: 'D'.repeat(50)}]);
        }, restorePublish);
        await assert.rejects(cloudNotice.publishDomainNotice('not a domain', 'phishing'), error => error === 'notice_invalid_domain');
        await assert.rejects(cloudNotice.publishUserNotice(certificate, 'unreceipted_gap', {bytes_sent: 1}, receiptFor(reporterList[1]).receipt, receiptFor(reporterList[1]).receipt_signature),
            error => error === 'notice_receipt_invalid');
        assert.equal(called, false);
    });

    test('an exit node reports an unreceipted gap once per certificate, with its receipt as proof', async() => {
        const publishedList = [];
        stubMethod(cloudNotice, '_anchor', noticeBodyList => {
            publishedList.push(...noticeBodyList);
            return Promise.resolve(noticeBodyList);
        }, restorePublish);
        const {receipt, receipt_signature: receiptSignature} = receiptFor(reporter);
        const state = () => ({
            session_id         : Math.random().toString(16).slice(2),
            session            : {close: () => undefined, destroy: () => undefined, destroyed: true},
            pass_type          : 'certificate',
            certificate,
            receipt,
            receipt_signature  : receiptSignature,
            bytes_sent         : 60 * 1024 * 1024,
            receipt_total_bytes: 1000,
            closed             : false
        });
        vpnExit._closeSession(state(), 'unreceipted_gap');
        vpnExit._closeSession(state(), 'unreceipted_gap');
        vpnExit._closeSession({...state(), receipt: undefined}, 'unreceipted_gap');
        vpnExit._closeSession(state(), 'idle');
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(publishedList.length, 1);
        assert.equal(publishedList[0].pattern, 'unreceipted_gap');
        assert.deepEqual(publishedList[0].numbers, {bytes_sent: 60 * 1024 * 1024, bytes_receipted: 1000});
        assert.equal(publishedList[0].certificate.certificate_id, certificate.certificate_id);
    });
});

describe('exit node and notices', () => {
    const exitNode    = newKey();
    const restoreExit = [];
    let noticedCertificate;
    before(async() => {
        noticedCertificate = cloudPass.signCertificate({...cloudPass.getCertificateBody(certificate), funding_transaction_id: 'H'.repeat(50)}, brokerKey.private_key);
        for (const node of reporterList.slice(0, 3)) {
            const notice = userNotice(node, {certificate: noticedCertificate, ...receiptFor(node, holder, noticedCertificate)});
            anchor([notice]);
            await cloudNotice.addNotice(notice);
            const domain = domainNotice(node, 'noticed.example.com');
            anchor([domain]);
            await cloudNotice.addNotice(domain);
        }
        stubMethod(network, 'nodeID', exitNode.address_base, restoreExit);
    });
    after(() => restoreExit.reverse().forEach(fn => fn()));

    test('refuses a certificate enough hosts reported', async() => {
        const state = {
            session_id: 'noticed',
            challenge : 'c'.repeat(64)
        };
        await assert.rejects(vpnExit._authenticate(state, {
            pass               : {
                certificate: noticedCertificate,
                piece      : cloudPass.signPiece(noticedCertificate, 0, certificateKey.private_key)
            },
            challenge_signature: cloudPass.signHolderMessage({
                challenge: state.challenge,
                node_id  : exitNode.address_base
            }, holder.private_key)
        }), error => error === 'pass_noticed');
    });

    test('refuses a tunnel to a domain enough hosts reported', async() => {
        const response = await new Promise(resolve => {
            const stream = {
                destroyed: false,
                closed   : false,
                respond  : headers => stream.status = headers[':status'],
                end      : body => resolve({status: stream.status, body: JSON.parse(body)})
            };
            vpnExit._onConnect({authenticated: true, session_id: 's', closed: false}, stream, 'cdn.noticed.example.com:443');
        });
        assert.deepEqual(response, {
            status: 403,
            body  : {error: 'domain_noticed'}
        });
    });
});
