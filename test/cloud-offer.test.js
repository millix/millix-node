import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import config from '../core/config/config';
import network from '../net/network';
import cloudOffer, {CLOUD_OFFER_VERSION} from '../net/cloud-offer';
import vpnExit from '../net/vpn/vpn-exit';
import walletUtils from '../core/wallet/wallet-utils';
import objectHash from '../core/crypto/object-hash';
import {fullAddress, newKey, now, stubRepositories} from './helper';

const node     = newKey();
const attacker = newKey();
const broker   = newKey();

/**
 * signs an offer body the way publishOffer does
 */
function signOffer(body, key = node) {
    return {
        ...body,
        offer_id : objectHash.getCHash288(body),
        signature: walletUtils.signMessage(key.node_private_key, body)
    };
}

function offerBody(overrides = {}) {
    const createDate = now();
    return {
        version          : CLOUD_OFFER_VERSION,
        node_id          : node.address_base,
        node_public_key  : node.public_key,
        service          : 'storage_host',
        location         : {
            country: 'US',
            city   : 'Boston'
        },
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
        create_date      : createDate,
        end_date         : createDate + 24 * 3600,
        ...overrides
    };
}

function vpnOfferBody(overrides = {}) {
    const body = offerBody({service: 'vpn_exit', ...overrides});
    if (!overrides.endpoint) {
        body.endpoint = {
            ...body.endpoint,
            service_port: config.NODE_PORT_VPN
        };
    }
    if (!('escrow' in overrides)) {
        body.escrow = {
            portion_bytes : config.VPN_ESCROW_PORTION_BYTES,
            portion_amount: config.VPN_ESCROW_PORTION_AMOUNT
        };
    }
    return body;
}

function verify(offer) {
    return cloudOffer.verifyOffer(offer);
}

function assertRefused(offer, reason) {
    assert.deepEqual(verify(offer), {
        valid: false,
        reason
    });
}

let restoreRepositories;
before(() => restoreRepositories = stubRepositories());
after(() => restoreRepositories());


describe('cloud offer signing (publishOffer)', () => {
    const restore    = [];
    const storedList = [];
    let previousOffer = null;
    let vpnRunning    = false;

    function stubMethod(object, name, value) {
        const original = object[name];
        object[name]   = value;
        restore.push(() => object[name] = original);
    }

    before(() => {
        restoreRepositories();
        restoreRepositories = stubRepositories({
            cloud_offer: {
                getOffer: () => Promise.resolve(previousOffer),
                addOffer: offer => {
                    storedList.push(offer);
                    return Promise.resolve(true);
                }
            }
        });
        stubMethod(network, 'initialized', true);
        stubMethod(network, 'nodeID', node.address_base);
        stubMethod(network, 'nodePublicKey', node.public_key);
        stubMethod(network, 'nodePrivateKey', node.node_private_key);
        stubMethod(network, 'nodePublicIp', '203.0.113.7');
        stubMethod(vpnExit, 'isRunning', () => vpnRunning);
        // publishing must not reach any peer
        stubMethod(cloudOffer, 'propagateOfferList', () => undefined);
    });
    after(() => restore.reverse().forEach(fn => fn()));

    const brokerList = () => [
        {
            address   : fullAddress(broker),
            public_key: broker.public_key
        }
    ];

    test('signs an offer with the node key that every node can verify', async() => {
        const offer = await cloudOffer.publishOffer('storage_host', {country: 'DE'}, 1000, brokerList(), now() + 3600);
        assert.deepEqual(verify(offer), {valid: true});
        assert.equal(offer.node_id, node.address_base);
        assert.equal(offer.node_id, walletUtils.getNodeIdFromPublicKey(offer.node_public_key));
        assert.equal(offer.offer_id, objectHash.getCHash288(Object.fromEntries(Object.entries(offer).filter(([key]) => !['offer_id', 'signature'].includes(key)))));
        assert.equal(storedList.at(-1), offer);
    });

    test('a newer offer for the same service is dated after the one it replaces', async() => {
        previousOffer = {create_date: now() + 30};
        const offer   = await cloudOffer.publishOffer('storage_host', {country: 'DE'}, 1000, brokerList(), now() + 3600);
        assert.equal(offer.create_date, previousOffer.create_date + 1);
        assert.deepEqual(verify(offer), {valid: true});
        previousOffer = null;
    });

    test('a vpn exit offer needs the exit service running', async() => {
        vpnRunning = false;
        await assert.rejects(cloudOffer.publishOffer('vpn_exit', {country: 'DE'}, 1000, brokerList(), now() + 3600), error => error === 'vpn_exit_not_running');
    });

    test('a vpn exit offer carries the service port and the escrow price', async() => {
        vpnRunning  = true;
        const offer = await cloudOffer.publishOffer('vpn_exit', {country: 'DE'}, 1000, brokerList(), now() + 3600);
        assert.deepEqual(verify(offer), {valid: true});
        assert.equal(offer.endpoint.service_port, config.NODE_PORT_VPN);
        assert.deepEqual(offer.escrow, {
            portion_bytes : config.VPN_ESCROW_PORTION_BYTES,
            portion_amount: config.VPN_ESCROW_PORTION_AMOUNT
        });
    });

    test('an offer that fails its own check is not stored', async() => {
        const storedCount = storedList.length;
        await assert.rejects(cloudOffer.publishOffer('storage_host', {country: 'germany'}, 1000, brokerList(), now() + 3600), error => error === 'offer_invalid_location');
        assert.equal(storedList.length, storedCount);
    });
});

describe('cloud offer verification', () => {
    test('accepts a signed storage offer and a signed vpn exit offer', () => {
        assert.deepEqual(verify(signOffer(offerBody())), {valid: true});
        assert.deepEqual(verify(signOffer(vpnOfferBody())), {valid: true});
    });

    describe('expiry', () => {
        test('refuses an offer past its end date', () => {
            assertRefused(signOffer(offerBody({create_date: now() - 7200, end_date: now() - 1})), 'offer_expired');
        });

        test('refuses an offer that ends at its creation', () => {
            const createDate = now();
            assertRefused(signOffer(offerBody({create_date: createDate, end_date: createDate})), 'offer_invalid_date');
        });

        test('refuses an offer that runs longer than CLOUD_OFFER_DURATION_MAX', () => {
            const createDate = now();
            assertRefused(signOffer(offerBody({create_date: createDate, end_date: createDate + config.CLOUD_OFFER_DURATION_MAX + 1})), 'offer_invalid_date');
            assert.deepEqual(verify(signOffer(offerBody({create_date: createDate, end_date: createDate + config.CLOUD_OFFER_DURATION_MAX}))), {valid: true});
        });

        test('refuses an offer created in the future, beyond the clock skew tolerance', () => {
            const createDate = now() + config.CLOUD_OFFER_CLOCK_SKEW_TOLERANCE + 60;
            assertRefused(signOffer(offerBody({create_date: createDate, end_date: createDate + 3600})), 'offer_invalid_date');
        });
    });

    describe('forgery', () => {
        test('refuses an offer changed after signing', () => {
            const offer             = signOffer(offerBody());
            offer.upload_speed_kbps = 900000;
            assertRefused(offer, 'offer_invalid_id');
        });

        test('refuses an offer changed after signing with its id recomputed', () => {
            const offer    = signOffer(offerBody());
            offer.location = {country: 'CH'};
            offer.offer_id = objectHash.getCHash288(Object.fromEntries(Object.entries(offer).filter(([key]) => !['offer_id', 'signature'].includes(key))));
            assertRefused(offer, 'offer_invalid_signature');
        });

        test('refuses an offer in another node\'s name signed by a different key', () => {
            assertRefused(signOffer(offerBody(), attacker), 'offer_invalid_signature');
        });

        test('refuses an offer that keeps another node\'s id with the signer\'s own public key', () => {
            assertRefused(signOffer(offerBody({node_public_key: attacker.public_key}), attacker), 'offer_invalid_signature');
        });

        test('refuses an offer with the signature removed', () => {
            const offer     = signOffer(offerBody());
            offer.signature = '';
            assertRefused(offer, 'offer_invalid_signature');
        });

        test('refuses a broker whose public key is not the key of its address', () => {
            assertRefused(signOffer(offerBody({
                broker_list: [
                    {
                        address   : fullAddress(broker),
                        public_key: attacker.public_key
                    }
                ]
            })), 'offer_invalid_broker_list');
        });
    });

    describe('limits', () => {
        test('refuses an offer larger than CLOUD_OFFER_SIZE_MAX', () => {
            const brokerList = Array.from({length: config.CLOUD_OFFER_BROKER_MAX}, () => ({
                address   : fullAddress(broker) + 'x'.repeat(200),
                public_key: broker.public_key
            }));
            assertRefused(signOffer(offerBody({broker_list: brokerList})), 'offer_too_large');
        });

        test(`accepts ${config.CLOUD_OFFER_BROKER_MAX} brokers and refuses one more`, () => {
            const brokerList = Array.from({length: config.CLOUD_OFFER_BROKER_MAX}, () => {
                const key = newKey();
                return {
                    address   : fullAddress(key),
                    public_key: key.public_key
                };
            });
            assert.deepEqual(verify(signOffer(offerBody({broker_list: brokerList}))), {valid: true});
            assertRefused(signOffer(offerBody({broker_list: [...brokerList, brokerList[0]]})), 'offer_invalid_broker_list');
        });

        test('refuses an offer without brokers', () => {
            // the object hash cannot hash an empty list, so this offer is
            // put together by hand
            const offer       = signOffer(offerBody());
            offer.broker_list = [];
            assertRefused(offer, 'offer_invalid_broker_list');
        });

        for (const [name, overrides, reason] of [
            ['an unknown version', {version: CLOUD_OFFER_VERSION + 1}, 'offer_invalid_format'],
            ['an extra field', {note: 'x'}, 'offer_invalid_format'],
            ['an unknown service', {service: 'bitcoin_mining'}, 'offer_invalid_service'],
            ['a country that is not a two letter code', {location: {country: 'usa'}}, 'offer_invalid_location'],
            ['a city longer than 100 characters', {location: {country: 'US', city: 'x'.repeat(101)}}, 'offer_invalid_location'],
            ['an upload speed of 0', {upload_speed_kbps: 0}, 'offer_invalid_upload_speed'],
            ['an endpoint without a port', {endpoint: {node_prefix: 'wss://', node_address: '203.0.113.7', node_port_api: 1}}, 'offer_invalid_endpoint'],
            ['an escrow price with a portion below ESCROW_PORTION_BYTES_MIN', {escrow: {portion_bytes: config.ESCROW_PORTION_BYTES_MIN - 1, portion_amount: 1}}, 'offer_invalid_escrow']
        ]) {
            test(`refuses ${name}`, () => assertRefused(signOffer(offerBody(overrides)), reason));
        }

        test('refuses a vpn exit offer without a service port', () => {
            assertRefused(signOffer(vpnOfferBody({endpoint: offerBody().endpoint})), 'offer_invalid_endpoint');
        });

        test('refuses a vpn exit offer without an escrow price', () => {
            const body = vpnOfferBody();
            delete body.escrow;
            assertRefused(signOffer(body), 'offer_invalid_escrow');
        });

        test('refuses something that is not an offer', () => {
            assertRefused(null, 'offer_invalid_format');
            assertRefused([], 'offer_invalid_format');
            assertRefused('offer', 'offer_invalid_format');
        });
    });
});
