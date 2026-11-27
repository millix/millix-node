import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import config from '../core/config/config';
import network from '../net/network';
import cloudOffer, {CLOUD_OFFER_VERSION} from '../net/cloud-offer';
import vpnExit from '../net/vpn/vpn-exit';
import cloudNotice from '../net/cloud-notice';
import CloudOfferRepository from '../database/repositories/cloud-offer';
import walletUtils from '../core/wallet/wallet-utils';
import objectHash from '../core/crypto/object-hash';
import escrow from '../core/wallet/escrow';
import wallet from '../core/wallet/wallet';
import cloudPass, {GB} from '../net/broker/cloud-pass';
import {fullAddress, newKey, newNonce, now, openCloudDatabase, stubRepositories, walletKey} from './helper';

// the host is named by its wallet's key identifier (nodeWallet); the node key
// only says which node serves the endpoint
const node       = newKey();
const nodeWallet = newKey();
const attacker   = newKey();
const broker     = newKey();
const hostWallet = newKey();
// the port the browser's storage service listens on by default
const STORAGE_PORT = 15601;

/**
 * signs an offer body the way publishOffer does: with the node key and with
 * the key of the wallet's key identifier
 */
function signOffer(body, key = node, walletSigner = nodeWallet) {
    return {
        ...body,
        offer_id         : objectHash.getCHash288(body),
        signature        : walletUtils.signMessage(key.node_private_key, body),
        address_signature: cloudPass.signKeyIdentityMessage(body, walletSigner.private_key)
    };
}

/**
 * the fields that name a host whose node key and wallet key are key
 */
function hostOf(key) {
    return {
        address_key_identifier: key.address_base,
        address_public_key    : key.public_key,
        node_id               : key.address_base,
        node_public_key       : key.public_key
    };
}

function offerIdOf(offer) {
    return objectHash.getCHash288(Object.fromEntries(Object.entries(offer).filter(([key]) => !['offer_id', 'signature', 'address_signature'].includes(key))));
}

function offerBody(overrides = {}) {
    const createDate = now();
    return {
        version               : CLOUD_OFFER_VERSION,
        address_key_identifier: nodeWallet.address_base,
        address_public_key    : nodeWallet.public_key,
        node_id               : node.address_base,
        node_public_key       : node.public_key,
        service               : 'storage_host',
        location              : {
            country: 'US',
            city   : 'Boston'
        },
        upload_speed_kbps     : 50000,
        endpoint              : {
            node_prefix  : 'wss://',
            node_address : '203.0.113.7',
            node_port    : config.NODE_PORT,
            node_port_api: config.NODE_PORT_API
        },
        broker_list           : [
            {
                address   : fullAddress(broker),
                public_key: broker.public_key
            }
        ],
        create_date           : createDate,
        end_date              : createDate + 24 * 3600,
        ...overrides
    };
}

/**
 * the terms of a storage host as the signed offer carries them
 */
function storageTerms(overrides = {}) {
    return {
        price_gb_hour    : 120,
        price_fetch_gb   : 5000,
        address          : fullAddress(hostWallet),
        free_gb          : 250,
        accept_new       : true,
        rental_period_min: 3600,
        ...overrides
    };
}

/**
 * a storage host offer that can be paid and used. offerBody() alone is the
 * offer of an older node: it names the node only.
 */
function storageOfferBody(storageOverrides = {}, overrides = {}) {
    const body = offerBody(overrides);
    return {
        ...body,
        endpoint: overrides.endpoint || {
            ...body.endpoint,
            service_port: STORAGE_PORT
        },
        storage : storageTerms(storageOverrides)
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
        stubMethod(wallet, 'getKeyIdentifierKey', () => walletKey(nodeWallet));
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

    // what the storage service tells the node to sign
    const storage = (overrides = {}) => ({
        service_port: STORAGE_PORT,
        ...storageTerms(overrides)
    });

    test('signs an offer with the wallet key and the node key that every node can verify', async() => {
        const offer = await cloudOffer.publishOffer('storage_host', {country: 'DE'}, 1000, brokerList(), now() + 3600, storage());
        assert.deepEqual(verify(offer), {valid: true});
        // the host is named by its wallet's key identifier
        assert.equal(offer.address_key_identifier, nodeWallet.address_base);
        assert.equal(offer.address_public_key, nodeWallet.public_key);
        assert.equal(offer.address_key_identifier, escrow.getAddressFromPublicKey(offer.address_public_key));
        // the node only serves the endpoint
        assert.equal(offer.node_id, node.address_base);
        assert.equal(offer.node_id, walletUtils.getNodeIdFromPublicKey(offer.node_public_key));
        assert.equal(offer.offer_id, offerIdOf(offer));
        assert.equal(storedList.at(-1), offer);
    });

    test('a newer offer for the same service is dated after the one it replaces', async() => {
        previousOffer = {create_date: now() + 30};
        const offer   = await cloudOffer.publishOffer('storage_host', {country: 'DE'}, 1000, brokerList(), now() + 3600, storage());
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
        await assert.rejects(cloudOffer.publishOffer('storage_host', {country: 'germany'}, 1000, brokerList(), now() + 3600, storage()), error => error === 'offer_invalid_location');
        assert.equal(storedList.length, storedCount);
    });

    test('a storage host offer carries the storage service port, the prices, the wallet to pay, the free space, whether it accepts new files and the minimum rental period', async() => {
        const offer = await cloudOffer.publishOffer('storage_host', {country: 'DE'}, 1000, brokerList(), now() + 3600, storage());
        assert.deepEqual(verify(offer), {valid: true});
        assert.equal(offer.endpoint.service_port, STORAGE_PORT);
        assert.deepEqual(offer.storage, {
            price_gb_hour    : 120,
            price_fetch_gb   : 5000,
            address          : fullAddress(hostWallet),
            free_gb          : 250,
            accept_new       : true,
            rental_period_min: 3600
        });
        assert.equal(cloudOffer.isNodeOnly(offer), false);
        // the node ports are still the node's own
        assert.equal(offer.endpoint.node_port, config.NODE_PORT);
        assert.equal(offer.endpoint.node_port_api, config.NODE_PORT_API);
    });

    test('a full host that takes no new files and charges nothing for fetches can say so', async() => {
        const offer = await cloudOffer.publishOffer('storage_host', {country: 'DE'}, 1000, brokerList(), now() + 3600, storage({free_gb: 0, accept_new: false, price_fetch_gb: 0}));
        assert.deepEqual(verify(offer), {valid: true});
        assert.equal(offer.storage.free_gb, 0);
        assert.equal(offer.storage.accept_new, false);
        assert.equal(offer.storage.price_fetch_gb, 0);
    });

    test('this node does not sign a storage host offer without its terms', async() => {
        const storedCount = storedList.length;
        await assert.rejects(cloudOffer.publishOffer('storage_host', {country: 'DE'}, 1000, brokerList(), now() + 3600), error => error === 'offer_invalid_storage');
        await assert.rejects(cloudOffer.publishOffer('storage_host', {country: 'DE'}, 1000, brokerList(), now() + 3600, 'storage'), error => error === 'offer_invalid_storage');
        assert.equal(storedList.length, storedCount);
    });

    test('a storage host offer with malformed terms is not signed', async() => {
        const storedCount = storedList.length;
        const {service_port, ...withoutPort} = storage();
        await assert.rejects(cloudOffer.publishOffer('storage_host', {country: 'DE'}, 1000, brokerList(), now() + 3600, withoutPort), error => error === 'offer_invalid_endpoint');
        await assert.rejects(cloudOffer.publishOffer('storage_host', {country: 'DE'}, 1000, brokerList(), now() + 3600, storage({price_gb_hour: '120'})), error => error === 'offer_invalid_storage');
        await assert.rejects(cloudOffer.publishOffer('storage_host', {country: 'DE'}, 1000, brokerList(), now() + 3600, storage({address: 'not-an-address'})), error => error === 'offer_invalid_storage');
        assert.equal(storedList.length, storedCount);
    });

    test('only a storage host offer takes storage terms', async() => {
        vpnRunning = true;
        await assert.rejects(cloudOffer.publishOffer('vpn_exit', {country: 'DE'}, 1000, brokerList(), now() + 3600, storage()), error => error === 'offer_invalid_storage');
    });

    test('publishing again keeps the storage terms and the service port', async() => {
        const offer   = await cloudOffer.publishOffer('storage_host', {country: 'DE'}, 1000, brokerList(), now() + 3600, storage());
        previousOffer = offer;
        const again   = await cloudOffer.republishOffer('storage_host');
        assert.deepEqual(verify(again), {valid: true});
        assert.deepEqual(again.storage, offer.storage);
        assert.equal(again.endpoint.service_port, STORAGE_PORT);
        assert.equal(again.create_date, offer.create_date + 1);
        previousOffer = null;
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
            offer.offer_id = offerIdOf(offer);
            assertRefused(offer, 'offer_invalid_address_signature');
        });

        test('refuses an offer in another node\'s name signed by a different key', () => {
            assertRefused(signOffer(offerBody(), attacker), 'offer_invalid_signature');
        });

        test('refuses an offer in another wallet\'s name signed by a different key', () => {
            assertRefused(signOffer(offerBody(), node, attacker), 'offer_invalid_address_signature');
        });

        test('refuses an offer that keeps another wallet\'s key identifier with the signer\'s own public key', () => {
            assertRefused(signOffer(offerBody({address_public_key: attacker.public_key}), node, attacker), 'offer_invalid_address_signature');
        });

        test('refuses an offer with the address signature removed, or without the wallet it names', () => {
            const offer             = signOffer(offerBody());
            offer.address_signature = '';
            assertRefused(offer, 'offer_invalid_address_signature');
            const withoutWallet = signOffer(offerBody());
            delete withoutWallet.address_key_identifier;
            assertRefused(withoutWallet, 'offer_invalid_format');
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

    describe('storage host terms', () => {
        test('accepts a storage host offer with its service port and terms', () => {
            const offer = signOffer(storageOfferBody());
            assert.deepEqual(verify(offer), {valid: true});
            assert.equal(cloudOffer.isNodeOnly(offer), false);
        });

        test('accepts the offer of an older node, without service port or terms, as node only', () => {
            const offer = signOffer(offerBody());
            assert.equal(offer.storage, undefined);
            assert.equal(offer.endpoint.service_port, undefined);
            assert.deepEqual(verify(offer), {valid: true});
            assert.equal(cloudOffer.isNodeOnly(offer), true);
        });

        test('an offer of another service is never node only', () => {
            assert.equal(cloudOffer.isNodeOnly(signOffer(vpnOfferBody())), false);
        });

        test('accepts a fetch price of 0, no free space and a host that takes no new files', () => {
            assert.deepEqual(verify(signOffer(storageOfferBody({price_fetch_gb: 0, free_gb: 0, accept_new: false}))), {valid: true});
        });

        test('accepts a minimum rental period up to CLOUD_STORAGE_RENTAL_PERIOD_MAX and refuses one second more', () => {
            assert.deepEqual(verify(signOffer(storageOfferBody({rental_period_min: config.CLOUD_STORAGE_RENTAL_PERIOD_MAX}))), {valid: true});
            assertRefused(signOffer(storageOfferBody({rental_period_min: config.CLOUD_STORAGE_RENTAL_PERIOD_MAX + 1})), 'offer_invalid_storage');
        });

        const escrowAddress = escrow.getEscrowAddress({
            version         : config.ESCROW_TERMS_VERSION,
            payer_public_key: attacker.public_key,
            payee_public_key: node.public_key,
            amount          : 1000,
            portion_bytes   : config.ESCROW_PORTION_BYTES_MIN,
            portion_amount  : 10,
            unlock_date     : now() + 3600,
            nonce           : newNonce()
        }).address;

        for (const [name, storageOverrides] of [
            ['a price per GB per hour of 0', {price_gb_hour: 0}],
            ['a negative price per GB per hour', {price_gb_hour: -120}],
            ['a price per GB per hour that is not an integer', {price_gb_hour: 1.5}],
            ['a price per GB per hour given as text', {price_gb_hour: '120'}],
            ['a price per GB per hour beyond the safe integers', {price_gb_hour: 2 ** 53}],
            ['a negative fetch price', {price_fetch_gb: -1}],
            ['a fetch price that is not an integer', {price_fetch_gb: 0.5}],
            ['a wallet address that does not parse', {address: 'not-an-address'}],
            ['a wallet address with a changed character', {address: fullAddress(hostWallet).replace(/.$/, c => c === 'a' ? 'b' : 'a')}],
            ['a wallet address that is only the address base', {address: hostWallet.address_base}],
            ['an escrow address as the wallet to pay', {address: escrowAddress}],
            ['a wallet address that is not text', {address: 15601}],
            ['negative free space', {free_gb: -1}],
            ['free space that is not an integer', {free_gb: 12.5}],
            ['accept_new that is not true or false', {accept_new: 1}],
            ['a minimum rental period of 0', {rental_period_min: 0}],
            ['a minimum rental period given as text', {rental_period_min: '1h'}],
            ['an extra field in the terms', {proofs: 12}]
        ]) {
            test(`refuses ${name}`, () => assertRefused(signOffer(storageOfferBody(storageOverrides)), 'offer_invalid_storage'));
        }

        for (const field of ['price_gb_hour', 'price_fetch_gb', 'address', 'free_gb', 'accept_new', 'rental_period_min']) {
            test(`refuses terms without ${field}`, () => {
                const body = storageOfferBody();
                delete body.storage[field];
                assertRefused(signOffer(body), 'offer_invalid_storage');
            });
        }

        test('refuses terms that are not an object', () => {
            assertRefused(signOffer({...storageOfferBody(), storage: 'yes'}), 'offer_invalid_storage');
            assertRefused(signOffer({...storageOfferBody(), storage: [120]}), 'offer_invalid_storage');
        });

        test('refuses terms without the storage service port', () => {
            assertRefused(signOffer(storageOfferBody({}, {endpoint: offerBody().endpoint})), 'offer_invalid_endpoint');
        });

        for (const [name, servicePort] of [
            ['of 0', 0],
            ['above 65535', 65536],
            ['given as text', '15601']
        ]) {
            test(`refuses a storage service port ${name}`, () => {
                assertRefused(signOffer(storageOfferBody({}, {
                    endpoint: {
                        ...offerBody().endpoint,
                        service_port: servicePort
                    }
                })), 'offer_invalid_endpoint');
            });
        }

        test('refuses storage terms in an offer of another service', () => {
            assertRefused(signOffer({...vpnOfferBody(), storage: storageTerms()}), 'offer_invalid_storage');
        });

        test('refuses terms changed after signing', () => {
            const offer                 = signOffer(storageOfferBody());
            offer.storage.price_gb_hour = 1;
            assertRefused(offer, 'offer_invalid_id');
        });
    });
});

describe('cloud offers received from a peer (_onOfferList)', () => {
    const restore = [];
    const ws      = {nodeID: attacker.address_base, node: 'wss://198.51.100.9:10000'};
    let propagated;

    function stubMethod(object, name, value) {
        const original = object[name];
        object[name]   = value;
        restore.push(() => object[name] = original);
    }

    /**
     * hands the offers to the node as a peer would, and waits until it sent
     * on the ones that were new to it
     */
    function receive(offerList) {
        return new Promise(resolve => {
            propagated = resolve;
            cloudOffer._onOfferList({offer_list: offerList}, ws);
        });
    }

    before(async() => {
        restoreRepositories();
        // the real cloud_offer repository, on the table of migration 24
        restoreRepositories = stubRepositories({cloud_offer: new CloudOfferRepository(await openCloudDatabase([24]))});
        stubMethod(cloudNotice, 'recordHost', () => Promise.resolve());
        // nothing is sent to a peer
        stubMethod(cloudOffer, 'propagateOfferList', (offerList, excludeWS) => propagated({offerList, excludeWS}));
    });
    after(() => restore.reverse().forEach(fn => fn()));

    test('stores and lists a storage host offer with its terms, and sends it on', async() => {
        const offer                  = signOffer(storageOfferBody());
        const {offerList, excludeWS} = await receive([offer]);
        assert.deepEqual(offerList, [offer]);
        assert.equal(excludeWS, ws);

        const listed = await cloudOffer.listOffers({service: 'storage_host'}, 'create_date desc', 1000);
        assert.deepEqual(listed, [offer]);
        assert.deepEqual(verify(listed[0]), {valid: true});
        assert.equal(listed[0].endpoint.service_port, STORAGE_PORT);
        assert.deepEqual(listed[0].storage, storageTerms());
    });

    test('stores and lists the offer of an older node as node only, and sends it on', async() => {
        const older       = newKey();
        const offer       = signOffer(offerBody(hostOf(older)), older, older);
        const {offerList} = await receive([offer]);
        assert.deepEqual(offerList, [offer]);

        const listed    = await cloudOffer.listOffers({service: 'storage_host'}, 'create_date desc', 1000);
        const olderList = listed.filter(listedOffer => listedOffer.address_key_identifier === older.address_base);
        assert.deepEqual(olderList, [offer]);
        assert.equal(cloudOffer.isNodeOnly(olderList[0]), true);
        assert.equal(listed.filter(listedOffer => !cloudOffer.isNodeOnly(listedOffer)).length, 1);
    });

    test('drops an offer with malformed storage terms and keeps the others of the same message', async() => {
        const bad         = newKey();
        const good        = newKey();
        const badOffer    = signOffer(storageOfferBody({price_gb_hour: 0}, hostOf(bad)), bad, bad);
        const goodOffer   = signOffer(storageOfferBody({price_gb_hour: 90}, hostOf(good)), good, good);
        const {offerList} = await receive([badOffer, goodOffer]);
        assert.deepEqual(offerList, [goodOffer]);

        const listed = await cloudOffer.listOffers({service: 'storage_host'}, 'create_date desc', 1000);
        assert.equal(listed.some(offer => offer.address_key_identifier === bad.address_base), false);
        assert.equal(listed.find(offer => offer.address_key_identifier === good.address_base).storage.price_gb_hour, 90);
    });

    test('a newer offer with changed terms replaces the wallet\'s older one', async() => {
        const createDate  = now() + 5;
        const offer       = signOffer(storageOfferBody({price_gb_hour: 150, free_gb: 40}, {
            create_date: createDate,
            end_date   : createDate + 3600
        }));
        const {offerList} = await receive([offer]);
        assert.deepEqual(offerList, [offer]);

        const listed = (await cloudOffer.listOffers({service: 'storage_host'}, 'create_date desc', 1000)).filter(listedOffer => listedOffer.address_key_identifier === nodeWallet.address_base);
        assert.deepEqual(listed, [offer]);
    });

    test('the wallet\'s newer offer replaces its older one even when served by another node', async() => {
        const otherNode   = newKey();
        const createDate  = now() + 10;
        const offer       = signOffer(storageOfferBody({price_gb_hour: 160}, {
            node_id        : otherNode.address_base,
            node_public_key: otherNode.public_key,
            create_date    : createDate,
            end_date       : createDate + 3600
        }), otherNode);
        const {offerList} = await receive([offer]);
        assert.deepEqual(offerList, [offer]);

        const listed = await cloudOffer.listOffers({service: 'storage_host'}, 'create_date desc', 1000);
        assert.deepEqual(listed.filter(listedOffer => listedOffer.address_key_identifier === nodeWallet.address_base), [offer]);
        assert.equal(listed.some(listedOffer => listedOffer.node_id === node.address_base && listedOffer.address_key_identifier === nodeWallet.address_base), false);
    });
});

describe('broker offers', () => {
    const terms = {
        address         : fullAddress(broker),
        public_key      : broker.public_key,
        pass_price      : 5000000,
        pass_data_bytes : 25 * GB,
        pass_piece_bytes: GB,
        pass_duration   : 7 * 24 * 3600,
        pool_rate       : 150000,
        payout_interval : 3600
    };

    function brokerOfferBody(addressKeyIdentifier) {
        const body = offerBody({
            service: 'broker',
            broker : cloudPass.signBrokerTerms(terms, addressKeyIdentifier, broker.private_key)
        });
        body.endpoint = {
            ...body.endpoint,
            service_port: config.NODE_PORT_BROKER
        };
        return body;
    }

    test('accepts broker terms signed for the wallet key identifier of the offer', () => {
        assert.deepEqual(verify(signOffer(brokerOfferBody(nodeWallet.address_base))), {valid: true});
    });

    test('refuses broker terms signed for the node id of the offer or for another wallet', () => {
        assertRefused(signOffer(brokerOfferBody(node.address_base)), 'offer_invalid_broker');
        assertRefused(signOffer(brokerOfferBody(attacker.address_base)), 'offer_invalid_broker');
    });
});
