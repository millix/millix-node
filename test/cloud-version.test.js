import {after, before, beforeEach, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {execFileSync} from 'child_process';
import config from '../core/config/config';
import network from '../net/network';
import eventBus from '../core/event-bus';
import cloudVersion from '../net/cloud-version';
import cloudOffer, {CLOUD_OFFER_VERSION} from '../net/cloud-offer';
import vpnExit from '../net/vpn/vpn-exit';
import vpnClient from '../net/vpn/vpn-client';
import brokerService from '../net/broker/broker';
import {forwardServer} from '../net/vpn/forward';
import walletUtils from '../core/wallet/wallet-utils';
import objectHash from '../core/crypto/object-hash';
import {fullAddress, newKey, now, stubRepositories} from './helper';

const tangled  = newKey();
const attacker = newKey();
const node     = newKey();
const broker   = newKey();
const network_ = config.MODE_TEST_NETWORK ? 'test' : 'main';

function versionMessage(versionMin, createDate = now(), key = tangled, networkName = network_) {
    return cloudVersion.signVersionMin(versionMin, createDate, key.private_key, networkName);
}

function signedOffer(nodeVersion) {
    const createDate = now();
    const body       = {
        version          : CLOUD_OFFER_VERSION,
        node_id          : node.address_base,
        node_public_key  : node.public_key,
        node_version     : nodeVersion,
        service          : 'storage_host',
        location         : {country: 'US'},
        upload_speed_kbps: 1000,
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
        end_date         : createDate + 3600
    };
    return {
        ...body,
        offer_id : objectHash.getCHash288(body),
        signature: walletUtils.signMessage(node.node_private_key, body)
    };
}

const restore    = [];
// the data folder the message is stored in
const dataFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-version-data-'));

function stubMethod(object, name, value) {
    const original = object[name];
    object[name]   = value;
    restore.push(() => object[name] = original);
}

before(() => {
    stubMethod(config, 'CLOUD_AUTHORITY_PUBLIC_KEY', tangled.public_key);
    restore.push(stubRepositories());
    stubMethod(config.DATABASE_CONNECTION, 'FOLDER', dataFolder);
    restore.push(() => fs.rmSync(dataFolder, {
        recursive: true,
        force    : true
    }));
});
after(() => restore.reverse().forEach(fn => fn()));
beforeEach(() => {
    cloudVersion.message = null;
    fs.rmSync(path.join(dataFolder, 'cloud_version_min.json'), {force: true});
});


describe('minimum version message', () => {
    test('accepts a message signed with tangled\'s key', () => {
        assert.deepEqual(cloudVersion.verifyMessage(versionMessage('1.27.0')), {valid: true});
    });

    for (const [name, build, reason] of [
        ['signed by another key', () => versionMessage('1.27.0', now(), attacker), 'version_message_invalid_signature'],
        ['changed after signing', () => ({...versionMessage('1.27.0'), version_min: '1.20.0'}), 'version_message_invalid_signature'],
        ['re-dated after signing', () => ({...versionMessage('1.27.0'), create_date: now() - 10}), 'version_message_invalid_signature'],
        ['for the other network', () => versionMessage('1.27.0', now(), tangled, network_ === 'main' ? 'test' : 'main'), 'version_message_other_network'],
        ['dated in the future', () => versionMessage('1.27.0', now() + config.CLOUD_OFFER_CLOCK_SKEW_TOLERANCE + 60), 'version_message_invalid_date'],
        ['with a version that is not x.y.z', () => versionMessage('1.27'), 'version_message_invalid_format'],
        ['with an extra field', () => ({...versionMessage('1.27.0'), note: 'x'}), 'version_message_invalid_format'],
        ['without a signature', () => {
            const message = versionMessage('1.27.0');
            delete message.signature;
            return message;
        }, 'version_message_invalid_format'],
        ['that is not an object', () => '1.27.0', 'version_message_invalid_format']
    ]) {
        test(`refuses a message ${name}`, () => assert.deepEqual(cloudVersion.verifyMessage(build()), {
            valid: false,
            reason
        }));
    }

    test('refuses every message while tangled\'s key is not set', () => {
        const key                         = config.CLOUD_AUTHORITY_PUBLIC_KEY;
        config.CLOUD_AUTHORITY_PUBLIC_KEY = null;
        try {
            assert.deepEqual(cloudVersion.verifyMessage(versionMessage('1.27.0')), {
                valid : false,
                reason: 'cloud_authority_not_set'
            });
        }
        finally {
            config.CLOUD_AUTHORITY_PUBLIC_KEY = key;
        }
    });

    test('the minimum is CLOUD_NODE_VERSION_MIN until a message sets it', () => {
        assert.equal(cloudVersion.getVersionMin(), config.CLOUD_NODE_VERSION_MIN);
        assert.equal(cloudVersion.isCloudEnabled(), true);
    });
});

describe('obeying the minimum version', () => {
    test('a newer message replaces the minimum, an older or equal one is ignored', async() => {
        const createDate = now() - 100;
        assert.equal(await cloudVersion.addMessage(versionMessage('1.27.0', createDate)), true);
        assert.equal(cloudVersion.getVersionMin(), '1.27.0');
        assert.equal(await cloudVersion.addMessage(versionMessage('1.20.0', createDate)), false);
        assert.equal(await cloudVersion.addMessage(versionMessage('1.20.0', createDate - 1)), false);
        assert.equal(cloudVersion.getVersionMin(), '1.27.0');
        assert.equal(await cloudVersion.addMessage(versionMessage('1.20.0', createDate + 1)), true);
        assert.equal(cloudVersion.getVersionMin(), '1.20.0');
    });

    test('a forged message changes nothing', async() => {
        await assert.rejects(cloudVersion.addMessage(versionMessage('9.0.0', now(), attacker)), error => error === 'version_message_invalid_signature');
        assert.equal(cloudVersion.getVersionMin(), config.CLOUD_NODE_VERSION_MIN);
    });

    test('a minimum above this node\'s version turns its cloud features off', async() => {
        const updateList = [];
        const listener   = update => updateList.push(update);
        eventBus.on('cloud_version_min_update', listener);
        try {
            await cloudVersion.addMessage(versionMessage('99.0.0'));
            assert.equal(cloudVersion.isCloudEnabled(), false);
            assert.deepEqual(updateList.at(-1), {
                version_min  : '99.0.0',
                cloud_enabled: false
            });
            await cloudVersion.addMessage(versionMessage(config.NODE_MILLIX_VERSION, now() + 1));
            assert.equal(cloudVersion.isCloudEnabled(), true);
        }
        finally {
            eventBus.removeListener('cloud_version_min_update', listener);
        }
    });

    test('the message is stored in the data folder and loaded again on restart', async() => {
        const message = versionMessage('1.30.0');
        await cloudVersion.addMessage(message);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataFolder, 'cloud_version_min.json'), 'utf8')), message);
        cloudVersion.message = null;
        await cloudVersion.initialize();
        cloudVersion.stop();
        assert.deepEqual(cloudVersion.message, message);
    });

    test('a stored message that does not verify is not loaded', async() => {
        fs.writeFileSync(path.join(dataFolder, 'cloud_version_min.json'), JSON.stringify(versionMessage('9.0.0', now(), attacker)));
        await cloudVersion.initialize();
        cloudVersion.stop();
        assert.equal(cloudVersion.message, null);
    });

    test('below the minimum a node publishes no offer and opens no vpn session', async() => {
        await cloudVersion.addMessage(versionMessage('99.0.0'));
        const restoreNetwork = [];
        for (const [name, value] of [['initialized', true], ['nodePrivateKey', node.node_private_key]]) {
            const original = network[name];
            network[name]  = value;
            restoreNetwork.push(() => network[name] = original);
        }
        try {
            await assert.rejects(cloudOffer.publishOffer('storage_host', {country: 'US'}, 1000, [], now() + 3600), error => error === 'cloud_version_not_accepted');
            await assert.rejects(vpnClient.openSession('offer', 1, 3600), error => error === 'cloud_version_not_accepted');
        }
        finally {
            restoreNetwork.forEach(fn => fn());
        }
    });

    test('below the minimum the exit node does not start, and stops when the minimum rises', async() => {
        const modeVPNExit    = config.MODE_VPN_EXIT;
        config.MODE_VPN_EXIT = true;
        try {
            await cloudVersion.addMessage(versionMessage('99.0.0'));
            await vpnExit.initialize();
            assert.equal(vpnExit.isRunning(), false);

            // a running exit node stops
            let stopped   = false;
            vpnExit.server = {close: () => stopped = true};
            vpnExit._onCloudVersionUpdate({cloud_enabled: false});
            assert.equal(stopped, true);
            assert.equal(vpnExit.isRunning(), false);
        }
        finally {
            config.MODE_VPN_EXIT = modeVPNExit;
            vpnExit.server       = null;
        }
    });

    test('the broker and the forwarding node stop when the minimum rises above this node', () => {
        for (const service of [brokerService, forwardServer]) {
            let stopped    = false;
            service.server = {close: () => stopped = true};
            try {
                service._onCloudVersionUpdate({cloud_enabled: false});
                assert.equal(stopped, true);
                assert.equal(service.isRunning(), false);
            }
            finally {
                service.server = null;
            }
        }
    });

    test('vpn sessions close when the minimum rises above this node', () => {
        const state = {
            session_id         : 's',
            bytes_received     : 0,
            receipt_total_bytes: 0,
            closed             : false
        };
        vpnClient.sessionMap.set('s', state);
        try {
            vpnClient._onCloudVersionUpdate({cloud_enabled: false});
            assert.equal(state.closed, true);
            assert.equal(state.close_reason, 'cloud_version_not_accepted');
        }
        finally {
            vpnClient.sessionMap.delete('s');
        }
    });

    test('stored offers of nodes below the minimum are no longer listed', async() => {
        const restoreRepositories = stubRepositories({
            cloud_offer: {listOffers: () => Promise.resolve([signedOffer(config.NODE_MILLIX_VERSION), signedOffer('1.27.0')])}
        });
        try {
            assert.equal((await cloudOffer.listOffers()).length, 2);
            await cloudVersion.addMessage(versionMessage('1.27.0'));
            assert.deepEqual((await cloudOffer.listOffers()).map(offer => offer.node_version), ['1.27.0']);
        }
        finally {
            restoreRepositories();
        }
    });

    test('offers from nodes below the minimum do not count', async() => {
        assert.deepEqual(cloudOffer.verifyOffer(signedOffer(config.NODE_MILLIX_VERSION)), {valid: true});
        await cloudVersion.addMessage(versionMessage('1.27.0'));
        assert.deepEqual(cloudOffer.verifyOffer(signedOffer(config.NODE_MILLIX_VERSION)), {
            valid : false,
            reason: 'offer_node_version_not_accepted'
        });
        assert.deepEqual(cloudOffer.verifyOffer(signedOffer('1.27.0')), {valid: true});
        const offer = signedOffer('1.27.0');
        offer.node_version = '1.27';
        assert.equal(cloudOffer.verifyOffer(offer).reason, 'offer_node_version_not_accepted');
    });
});

describe('spreading the minimum version', () => {
    function peerWS() {
        return {
            nodeConnectionReady: true,
            sent               : [],
            send(data) {
                this.sent.push(JSON.parse(data));
            }
        };
    }

    test('a new message is forwarded to every other peer; a known one is not', async() => {
        const from  = peerWS();
        const peers = [from, peerWS(), peerWS()];
        const descriptor = Object.getOwnPropertyDescriptor(network, 'registeredClients');
        Object.defineProperty(network, 'registeredClients', {
            value       : peers,
            configurable: true
        });
        try {
            const message = versionMessage('1.27.0');
            cloudVersion._onMessage({message}, from);
            await new Promise(resolve => setTimeout(resolve, 20));
            assert.deepEqual(peers.map(ws => ws.sent.length), [0, 1, 1]);
            assert.deepEqual(peers[1].sent[0], {
                type   : 'cloud_version_min',
                content: {message}
            });
            cloudVersion._onMessage({message}, peers[1]);
            await new Promise(resolve => setTimeout(resolve, 20));
            assert.deepEqual(peers.map(ws => ws.sent.length), [0, 1, 1]);
        }
        finally {
            descriptor ? Object.defineProperty(network, 'registeredClients', descriptor) : delete network.registeredClients;
        }
    });

    test('a new peer is sent the current message', async() => {
        const ws = peerWS();
        cloudVersion._onNewPeerConnection(ws);
        assert.equal(ws.sent.length, 0);
        await cloudVersion.addMessage(versionMessage('1.27.0'));
        cloudVersion._onNewPeerConnection(ws);
        assert.equal(ws.sent[0].content.message.version_min, '1.27.0');
    });
});

describe('signing tool (scripts/cloud/sign-version-min.js)', () => {
    test('makes a key and signs messages that nodes accept', () => {
        const folder  = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-version-'));
        const keyFile = path.join(folder, 'tangled.key');
        try {
            const run       = args => JSON.parse(execFileSync(process.execPath, ['--require', path.join(__dirname, 'setup.js'), path.join(__dirname, '..', 'scripts', 'cloud', 'sign-version-min.js'), ...args], {encoding: 'utf8'}));
            const {public_key: publicKey} = run(['--new-key', keyFile]);
            assert.equal((fs.statSync(keyFile).mode & 0o777), 0o600);
            const {message} = run(['--key', keyFile, '--version-min', '1.27.0', '--network', network_]);
            const key       = config.CLOUD_AUTHORITY_PUBLIC_KEY;
            config.CLOUD_AUTHORITY_PUBLIC_KEY = publicKey;
            try {
                assert.deepEqual(cloudVersion.verifyMessage(message), {valid: true});
                assert.equal(message.version_min, '1.27.0');
            }
            finally {
                config.CLOUD_AUTHORITY_PUBLIC_KEY = key;
            }
        }
        finally {
            fs.rmSync(folder, {
                recursive: true,
                force    : true
            });
        }
    });
});
