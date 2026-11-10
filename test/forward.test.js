import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import tls from 'tls';
import net from 'net';
import http2 from 'http2';
import config from '../core/config/config';
import network from '../net/network';
import eventBus from '../core/event-bus';
import walletUtils from '../core/wallet/wallet-utils';
import cloudOffer, {CLOUD_OFFER_VERSION} from '../net/cloud-offer';
import vpnExit from '../net/vpn/vpn-exit';
import vpnClient from '../net/vpn/vpn-client';
import * as forward from '../net/vpn/forward';
import objectHash from '../core/crypto/object-hash';
import {fullAddress, newKey, now, stubRepositories} from './helper';

const {
          ForwardHost,
          forwardServer,
          connectThroughForward,
          connectBySimultaneousOpen,
          readLine,
          writeLine
      } = forward;

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

/**
 * a node identity with its key and certificate, made the way a node makes
 * them, in a temporary folder
 */
async function newNodeIdentity(folder) {
    fs.mkdirSync(folder);
    const paths = {
        NODE_KEY_PATH            : path.join(folder, 'node.json'),
        NODE_CERTIFICATE_KEY_PATH: path.join(folder, 'node_certificate_key.pem'),
        NODE_CERTIFICATE_PATH    : path.join(folder, 'node_certificate.pem')
    };
    const original = {};
    Object.keys(paths).forEach(key => {
        original[key] = config[key];
        config[key]   = paths[key];
    });
    try {
        const certificate = await walletUtils.loadNodeKeyAndCertificate();
        const nodeKey     = await walletUtils.loadNodeKey();
        const nodeID      = walletUtils.getNodeIdFromCertificate(certificate.certificate_pem, 'pem');
        return {
            node_id         : nodeID,
            node_public_key : walletUtils.getNodePublicKeyFromCertificate(certificate.certificate_pem, 'pem'),
            node_private_key: nodeKey.privateKey,
            certificate_pem : certificate.certificate_pem,
            key_pem         : certificate.certificate_private_key_pem
        };
    }
    finally {
        Object.assign(config, original);
    }
}

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'forward-'));
let forwarder, host, other;
let forwardEndpoint;
let hostServer;
const hostConnectionList = [];

before(async() => {
    forwarder = await newNodeIdentity(path.join(folder, 'forwarder'));
    host      = await newNodeIdentity(path.join(folder, 'host'));
    other     = await newNodeIdentity(path.join(folder, 'other'));
    assert.equal(walletUtils.getAddressFromPublicKey(Buffer.from(host.node_private_key.toPublicKey().toBuffer())), host.node_id);

    stubMethod(config, 'MODE_CLOUD_FORWARD', true);
    stubMethod(config, 'NODE_PORT_FORWARD', 0);
    stubMethod(config, 'NODE_BIND_IP', '127.0.0.1');
    stubMethod(config, 'CLOUD_FORWARD_WAIT_TIME_MAX', 3000);
    stubMethod(network, 'certificatePem', forwarder.certificate_pem);
    stubMethod(network, 'certificatePrivateKeyPem', forwarder.key_pem);
    stubMethod(forwardServer, '_getNodeID', () => forwarder.node_id);
    await forwardServer.initialize();
    forwardEndpoint = {
        node_id     : forwarder.node_id,
        node_address: '127.0.0.1',
        service_port: forwardServer.server.address().port
    };

    // the host's own tls service: each connection it gets through the
    // forwarding node is served as if the client had connected directly
    hostServer = tls.createServer({
        key : host.key_pem,
        cert: host.certificate_pem
    }, socket => socket.end(`hello from ${host.node_id}`));
});
after(() => {
    forwardServer.stop();
    restore.reverse().forEach(fn => fn());
    fs.rmSync(folder, {
        recursive: true,
        force    : true
    });
});

function newForwardHost(identity = host, servicePort = 1) {
    const forwardHost = new ForwardHost(forwardEndpoint, servicePort, (socket, route) => {
        hostConnectionList.push(route);
        hostServer.emit('connection', socket);
    });
    forwardHost._getIdentity = () => identity;
    return forwardHost;
}

function readTLS(socket, nodeID) {
    return new Promise((resolve, reject) => {
        const secure = tls.connect({
            socket,
            rejectUnauthorized : false,
            checkServerIdentity: () => undefined
        });
        let data     = '';
        secure.on('secureConnect', () => {
            const peerNodeID = walletUtils.getNodeIdFromCertificate(secure.getPeerCertificate().raw.toString('hex'), 'hex');
            if (peerNodeID !== nodeID) {
                reject('wrong_host');
            }
        });
        secure.on('data', chunk => data += chunk);
        secure.on('end', () => resolve(data));
        secure.on('error', reject);
    });
}

describe('forwarding node: registration', () => {
    test('registers a host that proves its node key, and checks whether its port answers', async() => {
        const listening = net.createServer(socket => socket.destroy());
        await new Promise(resolve => listening.listen(0, '127.0.0.1', resolve));
        try {
            const reachableHost = newForwardHost(host, listening.address().port);
            assert.deepEqual(await reachableHost.register(), {reachable: true});
            reachableHost.stop();
            const closedPort = listening.address().port;
            listening.close();
            await new Promise(resolve => setTimeout(resolve, 50));
            const hiddenHost = newForwardHost(host, closedPort);
            assert.deepEqual(await hiddenHost.register(), {reachable: false});
            assert.ok(forwardServer.hostMap.has(host.node_id));
            hiddenHost.stop();
        }
        finally {
            listening.close();
        }
    });

    test('refuses a host whose proof is signed by another node key', async() => {
        const impostor = newForwardHost({
            ...host,
            node_private_key: other.node_private_key
        });
        await assert.rejects(impostor.register(), error => error === 'register_proof_invalid');
    });

    test('refuses a host that does not reach the forwarding node it expects', async() => {
        const wrongForward = new ForwardHost({
            ...forwardEndpoint,
            node_id: other.node_id
        }, 1, () => undefined);
        wrongForward._getIdentity = () => host;
        await assert.rejects(wrongForward.register(), error => error === 'node_certificate_invalid');
    });
});

describe('forwarding node: relaying', () => {
    let forwardHost;
    before(async() => {
        forwardHost = newForwardHost();
        await forwardHost.register();
    });
    after(() => forwardHost.stop());

    test('relays a client to the host; the client runs tls with the host itself', async() => {
        const socket = await connectThroughForward(forwardEndpoint, host.node_id);
        assert.equal(await readTLS(socket, host.node_id), `hello from ${host.node_id}`);
        assert.equal(hostConnectionList.at(-1), 'forward');
        assert.ok(forwardServer.hostMap.get(host.node_id).bytes_forwarded > 0);
    });

    test('refuses a client of a host that is not registered', async() => {
        await assert.rejects(connectThroughForward(forwardEndpoint, other.node_id), error => error === 'node_not_registered');
    });

    test('a connection naming a wrong token is not paired with the client', async() => {
        const pending = connectThroughForward(forwardEndpoint, host.node_id);
        const thief   = await forward.connectNodeService('127.0.0.1', forwardEndpoint.service_port, forwarder.node_id);
        writeLine(thief, {
            type   : 'accept',
            node_id: host.node_id,
            token  : 'f'.repeat(32)
        });
        await assert.rejects(readLine(thief), error => error === 'connection_closed');
        // the client still reaches the real host
        assert.equal(await readTLS(await pending, host.node_id), `hello from ${host.node_id}`);
    });

    test('a host whose registration closes is no longer reached', async() => {
        const otherHost = newForwardHost(other);
        await otherHost.register();
        otherHost.stop();
        await new Promise(resolve => setTimeout(resolve, 50));
        await assert.rejects(connectThroughForward(forwardEndpoint, other.node_id), error => error === 'node_not_registered');
    });
});

describe('simultaneous connect', () => {
    let forwardHost;
    before(async() => {
        forwardHost = newForwardHost();
        await forwardHost.register();
    });
    after(() => forwardHost.stop());

    test('client and host each connect from the port the forwarding node saw to the port it saw of the other, at once', async() => {
        // on loopback a closed port answers a syn at once with a reset, so
        // the two syns never cross as they do between two routers that drop
        // unexpected syns. this watches the rendezvous instead: both sides
        // are told the other's observed port and connect from their own.
        const callList = [];
        const restorePunch = [];
        stubMethod(forward.punchConnector, 'simultaneousConnect', (localPort, peerAddress, peerPort) => {
            callList.push({localPort, peerAddress, peerPort, time: Date.now()});
            return Promise.reject('punch_failed');
        }, restorePunch);
        try {
            await assert.rejects(connectBySimultaneousOpen(forwardEndpoint, host.node_id), error => error === 'punch_failed');
            await new Promise(resolve => setTimeout(resolve, 100));
            assert.equal(callList.length, 2);
            const [first, second] = callList;
            assert.equal(first.peerPort, second.localPort);
            assert.equal(second.peerPort, first.localPort);
            assert.equal(first.peerAddress, '127.0.0.1');
            assert.notEqual(first.localPort, first.peerPort);
            assert.ok(Math.abs(first.time - second.time) < 500);
        }
        finally {
            restorePunch.forEach(fn => fn());
        }
    });

    test('the ports of the probes are free again for the connect', async() => {
        let probePort;
        const restorePunch = [];
        stubMethod(forward.punchConnector, 'simultaneousConnect', localPort => {
            probePort = probePort || localPort;
            // bind the port the forwarding node saw, as the connect will
            return new Promise((resolve, reject) => {
                const server = net.createServer();
                server.once('error', error => reject(error.code));
                server.listen(localPort, () => {
                    server.close();
                    reject('punch_failed');
                });
            });
        }, restorePunch);
        try {
            await assert.rejects(connectBySimultaneousOpen(forwardEndpoint, host.node_id), error => error === 'punch_failed');
            assert.ok(probePort > 0);
        }
        finally {
            restorePunch.forEach(fn => fn());
        }
    });

    test('gives up after CLOUD_PUNCH_TIME_MAX when the peer never answers', async() => {
        const closed = net.createServer();
        await new Promise(resolve => closed.listen(0, '127.0.0.1', resolve));
        const port = closed.address().port;
        closed.close();
        const startTime = Date.now();
        await assert.rejects(forward.simultaneousConnect(0, '127.0.0.1', port, 300), error => error === 'punch_failed');
        assert.ok(Date.now() - startTime >= 300);
    });
});

describe('offers of hosts behind routers', () => {
    const node   = newKey();
    const broker = newKey();
    let restoreRepositories;
    before(() => restoreRepositories = stubRepositories());
    after(() => restoreRepositories());

    function vpnOffer(forwardValue) {
        const createDate = now();
        const body       = {
            version          : CLOUD_OFFER_VERSION,
            node_id          : node.address_base,
            node_public_key  : node.public_key,
            service          : 'vpn_exit',
            location         : {country: 'US'},
            upload_speed_kbps: 1000,
            endpoint         : {
                node_prefix  : 'wss://',
                node_address : '203.0.113.7',
                node_port    : config.NODE_PORT,
                node_port_api: config.NODE_PORT_API,
                service_port : config.NODE_PORT_VPN,
                ...(forwardValue ? {forward: forwardValue} : {})
            },
            escrow           : {
                portion_bytes : config.VPN_ESCROW_PORTION_BYTES,
                portion_amount: config.VPN_ESCROW_PORTION_AMOUNT
            },
            broker_list      : [{address: fullAddress(broker), public_key: broker.public_key}],
            create_date      : createDate,
            end_date         : createDate + 3600
        };
        return {
            ...body,
            offer_id : objectHash.getCHash288(body),
            signature: walletUtils.signMessage(node.node_private_key, body)
        };
    }

    test('an exit offer may name the forwarding node that reaches it', () => {
        assert.deepEqual(cloudOffer.verifyOffer(vpnOffer({
            node_id     : forwardNodeID,
            node_address: '198.51.100.1',
            service_port: 30007
        })), {valid: true});
    });

    const forwardNodeID = newKey().address_base;
    for (const [name, value] of [
        ['itself', {node_id: node.address_base, node_address: '198.51.100.1', service_port: 30007}],
        ['without a port', {node_id: forwardNodeID, node_address: '198.51.100.1'}],
        ['with an extra field', {node_id: forwardNodeID, node_address: '198.51.100.1', service_port: 30007, note: 'x'}]
    ]) {
        test(`refuses a forwarding node that is ${name}`, () => assert.equal(cloudOffer.verifyOffer(vpnOffer(value)).reason, 'offer_invalid_endpoint'));
    }
});

describe('exit node behind a router', () => {
    const restoreExit = [];
    let exitServer;
    before(() => {
        exitServer = http2.createSecureServer({
            key       : host.key_pem,
            cert      : host.certificate_pem,
            allowHTTP1: false
        });
        exitServer.on('stream', stream => {
            stream.respond({':status': 200});
            stream.end('{}');
        });
        stubMethod(vpnExit, 'server', exitServer, restoreExit);
        stubMethod(vpnExit, '_findForwardEndpoint', () => Promise.resolve(forwardEndpoint), restoreExit);
        stubMethod(ForwardHost.prototype, '_getIdentity', () => host, restoreExit);
    });
    after(() => {
        vpnExit.forwardHost && vpnExit.forwardHost.stop();
        vpnExit.forwardHost = null;
        restoreExit.reverse().forEach(fn => fn());
    });

    test('in auto mode an exit node whose port answers keeps no forwarding', async() => {
        const listening = net.createServer(socket => socket.destroy());
        await new Promise(resolve => listening.listen(0, '127.0.0.1', resolve));
        stubMethod(config, 'NODE_PORT_VPN', listening.address().port, restoreExit);
        stubMethod(config, 'VPN_EXIT_FORWARD', 'auto', restoreExit);
        try {
            await vpnExit._startForward();
            assert.equal(vpnExit.getForwardEndpoint(), null);
        }
        finally {
            listening.close();
            vpnExit.forwardHost = null;
        }
    });

    test('with no open port it is reached through the forwarding node, and its offer says so', async() => {
        stubMethod(config, 'NODE_PORT_VPN', 1, restoreExit);
        stubMethod(config, 'VPN_EXIT_FORWARD', 'always', restoreExit);
        const updates  = [];
        const listener = endpoint => updates.push(endpoint);
        eventBus.on('vpn_exit_forward_update', listener);
        try {
            await vpnExit._startForward();
            assert.deepEqual(vpnExit.getForwardEndpoint(), forwardEndpoint);
            assert.deepEqual(updates, [forwardEndpoint]);
        }
        finally {
            eventBus.removeListener('vpn_exit_forward_update', listener);
        }
    });

    test('a client tries a simultaneous connect first, and goes through the forwarding node when it fails', async() => {
        const offer = {
            node_id : host.node_id,
            endpoint: {
                node_address: '127.0.0.1',
                service_port: 1,
                forward     : forwardEndpoint
            }
        };
        // a punched socket is used as the connection to the exit node
        const punchedSocket = await connectThroughForward(forwardEndpoint, host.node_id);
        stubMethod(forward, 'connectBySimultaneousOpen', () => Promise.resolve(punchedSocket), restoreExit);
        const punched = await vpnClient._connect(offer);
        assert.equal(punched.route, 'punch');
        punched.session.destroy();

        // on loopback the real simultaneous connect fails (see above)
        stubMethod(config, 'CLOUD_PUNCH_TIME_MAX', 300, restoreExit);
        stubMethod(forward, 'connectBySimultaneousOpen', connectBySimultaneousOpen, restoreExit);
        const forwarded = await vpnClient._connect(offer);
        assert.equal(forwarded.route, 'forward');
        // the session works: a request reaches the exit node
        const response = await vpnClient._request(forwarded.session, 'GET', '/vpn/challenge');
        assert.deepEqual(response, {});
        forwarded.session.destroy();
    });

    test('a client refuses a relayed exit node whose certificate is not the offer\'s', async() => {
        const offer = {
            node_id : other.node_id,
            endpoint: {
                node_address: '127.0.0.1',
                service_port: 1,
                forward     : forwardEndpoint
            }
        };
        // the forwarding node only knows the host: the impostor id is refused
        await assert.rejects(vpnClient._connect(offer), error => error === 'node_not_registered');

        // a node registered as other that serves another node's
        // certificate: the client's own tls check refuses it
        stubMethod(forward, 'connectBySimultaneousOpen', () => Promise.reject('punch_failed'), restoreExit);
        const liar = new ForwardHost(forwardEndpoint, 1, socket => exitServer.emit('connection', socket));
        liar._getIdentity = () => other;
        await liar.register();
        try {
            await assert.rejects(vpnClient._connect(offer), error => error === 'exit_node_certificate_invalid');
        }
        finally {
            liar.stop();
        }
    });
});
