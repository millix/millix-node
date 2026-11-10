import _ from 'lodash';
import tls from 'tls';
import net from 'net';
import crypto from 'crypto';
import network from '../network';
import config from '../../core/config/config';
import walletUtils from '../../core/wallet/wallet-utils';
import eventBus from '../../core/event-bus';
import console from '../../core/console';

const LINE_SIZE_MAX = 4096;


/**
 * reads one json line from a socket that has just connected, then pauses
 * the socket and puts back what followed the line, so that the socket can
 * be piped or handed over
 */
export function readLine(socket, timeout = config.CLOUD_FORWARD_WAIT_TIME_MAX) {
    return new Promise((resolve, reject) => {
        let buffer = Buffer.alloc(0);
        const done = (error, message) => {
            clearTimeout(timer);
            socket.removeListener('data', onData);
            socket.removeListener('error', onError);
            socket.removeListener('close', onClose);
            error ? reject(error) : resolve(message);
        };
        const onData  = chunk => {
            buffer      = Buffer.concat([buffer, chunk]);
            const index = buffer.indexOf(0x0a);
            if (index === -1) {
                if (buffer.length > LINE_SIZE_MAX) {
                    done('line_too_long');
                }
                return;
            }
            socket.pause();
            const rest = buffer.subarray(index + 1);
            if (rest.length > 0) {
                socket.unshift(rest);
            }
            try {
                done(null, JSON.parse(buffer.subarray(0, index).toString('utf8')));
            }
            catch (e) {
                done('line_invalid');
            }
        };
        const onError = error => done(error.code || error.message || error);
        const onClose = () => done('connection_closed');
        const timer   = setTimeout(() => done('line_timeout'), timeout);
        socket.on('data', onData);
        socket.on('error', onError);
        socket.on('close', onClose);
        socket.resume();
    });
}

export function writeLine(socket, message) {
    if (!socket.destroyed) {
        socket.write(JSON.stringify(message) + '\n');
    }
}

/**
 * calls onMessage for every json line of a long lived connection
 */
function onLines(socket, onMessage) {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
            const line = buffer.substring(0, index);
            buffer     = buffer.substring(index + 1);
            try {
                onMessage(JSON.parse(line));
            }
            catch (e) {
                socket.destroy();
                return;
            }
        }
        if (buffer.length > LINE_SIZE_MAX) {
            socket.destroy();
        }
    });
}

/**
 * opens a tls connection to a node's service; it fails unless the node's
 * certificate carries nodeID
 */
export function connectNodeService(address, port, nodeID, options = {}) {
    return new Promise((resolve, reject) => {
        const socket = tls.connect({
            host              : address,
            port,
            rejectUnauthorized: false,
            checkServerIdentity: () => undefined,
            ...options
        });
        const timer  = setTimeout(() => {
            socket.destroy();
            reject('connection_timeout');
        }, config.CLOUD_FORWARD_WAIT_TIME_MAX);
        socket.once('error', error => {
            clearTimeout(timer);
            reject(error.code || error.message || error);
        });
        socket.once('secureConnect', () => {
            clearTimeout(timer);
            let peerNodeID;
            try {
                peerNodeID = walletUtils.getNodeIdFromCertificate(socket.getPeerCertificate().raw.toString('hex'), 'hex');
            }
            catch (e) {
            }
            if (peerNodeID !== nodeID) {
                socket.destroy();
                return reject('node_certificate_invalid');
            }
            resolve(socket);
        });
    });
}

/**
 * tcp simultaneous open: connects from localPort to the peer again and
 * again until the peer, doing the same at the same moment, gets through
 * both sides' routers. works where the routers keep the port of the
 * rendezvous connection for the new one.
 */
export function simultaneousConnect(localPort, peerAddress, peerPort, timeMax = config.CLOUD_PUNCH_TIME_MAX) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        let done        = false;
        const attempt   = () => {
            if (done) {
                return;
            }
            const socket = net.connect({
                host: peerAddress,
                port: peerPort,
                localPort
            });
            socket.once('connect', () => {
                if (done) {
                    return socket.destroy();
                }
                done = true;
                resolve(socket);
            });
            socket.once('error', () => {
                socket.destroy();
                if (done) {
                    return;
                }
                if (Date.now() - startTime >= timeMax) {
                    done = true;
                    return reject('punch_failed');
                }
                setTimeout(attempt, 50);
            });
        };
        attempt();
    });
}

// the connect step of a simultaneous connect, kept in an object so that
// tests can watch it
export const punchConnector = {simultaneousConnect};

/**
 * the forwarding node: relays clients to hosts that cannot be reached
 * directly (--cloud-forward true, tls with the node certificate on
 * NODE_PORT_FORWARD). every connection starts with one json line:
 *
 * - {type: register, node_id, node_public_key}: a host keeps this
 *   connection open. it is answered with a challenge, which the host signs
 *   with its node key ({type: register_proof, signature, service_port}).
 *   the forwarding node then checks whether the host's service port answers
 *   from outside and says so ({type: registered, reachable}).
 * - {type: connect, node_id}: a client of a registered host. the forwarding
 *   node asks the host for a new connection ({type: incoming, token} on the
 *   host's connection), which the host opens with {type: accept, node_id,
 *   token}; both get {type: connected} and the bytes are relayed as they
 *   are. the client and the host run their own tls inside, so the
 *   forwarding node sees neither the content nor the sites.
 * - {type: punch, node_id}: a client asks for a simultaneous connect. both
 *   sides open a short connection from the port they will use
 *   ({type: punch_probe, token, role}), the forwarding node tells each the
 *   address and port the other was seen from ({type: punch_start}) and closes
 *   the probes, and both connect to each other at once.
 */
class ForwardServer {
    constructor() {
        this.server  = null;
        this.hostMap = new Map();
        this.punchMap = new Map();
    }

    isRunning() {
        return !!this.server;
    }

    _getNodeID() {
        return network.nodeID;
    }

    _onSocket(socket) {
        socket.on('error', _ => _);
        readLine(socket)
            .then(message => {
                switch (message?.type) {
                    case 'register':
                        return this._onRegister(socket, message);
                    case 'connect':
                        return this._onConnect(socket, message);
                    case 'accept':
                        return this._onAccept(socket, message);
                    case 'punch':
                        return this._onPunch(socket, message);
                    case 'punch_probe':
                        return this._onPunchProbe(socket, message);
                    default:
                        socket.destroy();
                }
            })
            .catch(() => socket.destroy());
    }

    _fail(socket, error) {
        writeLine(socket, {
            type: 'error',
            error
        });
        socket.end();
    }

    _onRegister(socket, message) {
        if (!this.hostMap.has(message.node_id) && this.hostMap.size >= config.CLOUD_FORWARD_HOST_MAX) {
            return this._fail(socket, 'forward_host_max');
        }
        const challenge = crypto.randomBytes(32).toString('hex');
        writeLine(socket, {
            type: 'challenge',
            challenge
        });
        return readLine(socket).then(proof => {
            if (proof?.type !== 'register_proof' || typeof proof.signature !== 'string' ||
                !walletUtils.isValidNodeIdentity(message.node_id, message.node_public_key, {
                    challenge,
                    forward_node_id: this._getNodeID()
                }, proof.signature)) {
                return this._fail(socket, 'register_proof_invalid');
            }

            const previous = this.hostMap.get(message.node_id);
            if (previous) {
                previous.control.destroy();
            }
            const host = {
                node_id        : message.node_id,
                control        : socket,
                remote_address : socket.remoteAddress,
                pending_map    : new Map(),
                bytes_forwarded: 0,
                register_date  : Date.now()
            };
            this.hostMap.set(message.node_id, host);
            socket.setKeepAlive(true, 30000);
            socket.on('close', () => {
                if (this.hostMap.get(message.node_id) === host) {
                    this.hostMap.delete(message.node_id);
                    host.pending_map.forEach(pending => pending.socket.destroy());
                }
            });
            onLines(socket, _ => _);
            socket.resume();

            return this._isReachable(socket.remoteAddress, proof.service_port)
                       .then(reachable => {
                           console.log(`[forward] host ${message.node_id} registered from ${socket.remoteAddress} (service port ${reachable ? 'reachable' : 'not reachable'})`);
                           writeLine(socket, {
                               type            : 'registered',
                               reachable,
                               observed_address: socket.remoteAddress
                           });
                       });
        });
    }

    _isReachable(address, port) {
        if (!Number.isInteger(port) || port <= 0) {
            return Promise.resolve(false);
        }
        return new Promise(resolve => {
            const probe = net.connect({
                host: address,
                port
            });
            probe.setTimeout(3000, () => {
                probe.destroy();
                resolve(false);
            });
            probe.once('connect', () => {
                probe.destroy();
                resolve(true);
            });
            probe.once('error', () => resolve(false));
        });
    }

    _onConnect(socket, message) {
        const host = this.hostMap.get(message.node_id);
        if (!host) {
            return this._fail(socket, 'node_not_registered');
        }
        if (host.pending_map.size >= config.CLOUD_FORWARD_PENDING_MAX) {
            return this._fail(socket, 'node_busy');
        }
        const token = crypto.randomBytes(16).toString('hex');
        const timer = setTimeout(() => {
            host.pending_map.delete(token);
            this._fail(socket, 'node_not_answering');
        }, config.CLOUD_FORWARD_WAIT_TIME_MAX);
        host.pending_map.set(token, {
            socket,
            timer
        });
        socket.once('close', () => host.pending_map.delete(token));
        writeLine(host.control, {
            type: 'incoming',
            token
        });
    }

    _onAccept(socket, message) {
        const host    = this.hostMap.get(message.node_id);
        const pending = host?.pending_map.get(message.token);
        if (!pending) {
            return socket.destroy();
        }
        clearTimeout(pending.timer);
        host.pending_map.delete(message.token);
        const client = pending.socket;
        writeLine(client, {type: 'connected'});
        writeLine(socket, {type: 'connected'});
        client.on('data', chunk => host.bytes_forwarded += chunk.length);
        socket.on('data', chunk => host.bytes_forwarded += chunk.length);
        client.pipe(socket);
        socket.pipe(client);
        client.on('close', () => socket.destroy());
        socket.on('close', () => client.destroy());
        client.resume();
        socket.resume();
    }

    _onPunch(socket, message) {
        const host = this.hostMap.get(message.node_id);
        if (!host) {
            return this._fail(socket, 'node_not_registered');
        }
        const token = crypto.randomBytes(16).toString('hex');
        const punch = {
            client_control: socket,
            host_control  : host.control,
            probe_map     : {},
            timer         : setTimeout(() => {
                this.punchMap.delete(token);
                socket.destroy();
            }, config.CLOUD_FORWARD_WAIT_TIME_MAX)
        };
        this.punchMap.set(token, punch);
        socket.once('close', () => this.punchMap.delete(token));
        writeLine(socket, {
            type: 'punch_token',
            token
        });
        writeLine(host.control, {
            type: 'punch',
            token
        });
    }

    _onPunchProbe(socket, message) {
        const punch = this.punchMap.get(message.token);
        if (!punch || !['client', 'host'].includes(message.role) || punch.probe_map[message.role]) {
            return socket.destroy();
        }
        punch.probe_map[message.role] = {
            socket,
            address: socket.remoteAddress,
            port   : socket.remotePort
        };
        const {
                  client,
                  host
              } = punch.probe_map;
        if (!client || !host) {
            return;
        }
        clearTimeout(punch.timer);
        this.punchMap.delete(message.token);
        writeLine(punch.client_control, {
            type        : 'punch_start',
            token       : message.token,
            peer_address: host.address,
            peer_port   : host.port
        });
        writeLine(punch.host_control, {
            type        : 'punch_start',
            token       : message.token,
            peer_address: client.address,
            peer_port   : client.port
        });
        // this node closes the probes first, so the ports they used are
        // free again at once on both sides
        client.socket.destroy();
        host.socket.destroy();
        punch.client_control.end();
    }

    getHostList() {
        return [...this.hostMap.values()].map(host => ({
            node_id        : host.node_id,
            remote_address : host.remote_address,
            bytes_forwarded: host.bytes_forwarded,
            register_date  : Math.floor(host.register_date / 1000)
        }));
    }

    initialize() {
        if (!config.MODE_CLOUD_FORWARD || this.server) {
            return Promise.resolve();
        }
        if (!network.certificatePem) {
            return Promise.reject('node_certificate_not_found');
        }
        return new Promise(resolve => {
            this.server = tls.createServer({
                key : network.certificatePrivateKeyPem,
                cert: network.certificatePem
            }, socket => this._onSocket(socket));
            this.server.on('error', error => console.log(`[forward] server error: ${error.message}`));
            this.server.listen(config.NODE_PORT_FORWARD, config.NODE_BIND_IP, () => {
                console.log(`[forward] forwarding node listening on port ${config.NODE_PORT_FORWARD}`);
                resolve();
            });
        });
    }

    stop() {
        if (this.server) {
            this.server.close();
            this.hostMap.forEach(host => host.control.destroy());
            this.hostMap.clear();
            this.server = null;
        }
    }
}

export const forwardServer = new ForwardServer();


/**
 * a host's side of a forwarding node: keeps the registration open, opens a
 * connection for every client the forwarding node announces and takes part
 * in simultaneous connects. every connection it gets is handed to
 * onConnection(socket), as if the client had connected directly.
 */
export class ForwardHost {
    constructor(forwardEndpoint, servicePort, onConnection) {
        this.forward_endpoint = forwardEndpoint;
        this.service_port     = servicePort;
        this.onConnection     = onConnection;
        this.control          = null;
        this.registered       = false;
        this.reachable        = null;
        this.stopped          = false;
    }

    /**
     * this node's identity: its node id and keys
     */
    _getIdentity() {
        return {
            node_id         : network.nodeID,
            node_public_key : network.nodePublicKey,
            node_private_key: network.nodePrivateKey
        };
    }

    _connect() {
        return connectNodeService(this.forward_endpoint.node_address, this.forward_endpoint.service_port, this.forward_endpoint.node_id);
    }

    /**
     * @return {Promise<{reachable: boolean}>}
     */
    register() {
        return this._connect()
                   .then(socket => {
                       this.control   = socket;
                       const identity = this._getIdentity();
                       writeLine(socket, {
                           type           : 'register',
                           node_id        : identity.node_id,
                           node_public_key: identity.node_public_key
                       });
                       return readLine(socket)
                           .then(message => {
                               if (message?.type !== 'challenge') {
                                   return Promise.reject(message?.error || 'register_failed');
                               }
                               writeLine(socket, {
                                   type        : 'register_proof',
                                   signature   : walletUtils.signMessage(identity.node_private_key, {
                                       challenge      : message.challenge,
                                       forward_node_id: this.forward_endpoint.node_id
                                   }),
                                   service_port: this.service_port
                               });
                               return readLine(socket);
                           })
                           .then(message => {
                               if (message?.type !== 'registered') {
                                   return Promise.reject(message?.error || 'register_failed');
                               }
                               this.registered = true;
                               this.reachable  = message.reachable;
                               socket.setKeepAlive(true, 30000);
                               socket.on('close', () => this._onControlClosed());
                               onLines(socket, controlMessage => this._onControlMessage(controlMessage));
                               socket.resume();
                               return {reachable: message.reachable};
                           })
                           .catch(error => {
                               socket.destroy();
                               return Promise.reject(error);
                           });
                   });
    }

    _onControlClosed() {
        this.registered = false;
        this.control    = null;
        eventBus.emit('cloud_forward_host_closed', this);
    }

    _onControlMessage(message) {
        if (message.type === 'incoming') {
            this._accept(message.token).catch(error => console.log(`[forward] incoming connection not accepted: ${error}`));
        }
        else if (message.type === 'punch') {
            this._punch(message.token).catch(error => console.log(`[forward] simultaneous connect failed: ${error}`));
        }
        else if (message.type === 'punch_start') {
            const waiting = this._punchWaitMap?.get(message.token);
            waiting && waiting(message);
        }
    }

    _accept(token) {
        return this._connect()
                   .then(socket => {
                       writeLine(socket, {
                           type   : 'accept',
                           node_id: this._getIdentity().node_id,
                           token
                       });
                       return readLine(socket).then(message => {
                           if (message?.type !== 'connected') {
                               socket.destroy();
                               return Promise.reject(message?.error || 'accept_failed');
                           }
                           this.onConnection(socket, 'forward');
                       });
                   });
    }

    _waitPunchStart(token) {
        this._punchWaitMap = this._punchWaitMap || new Map();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._punchWaitMap.delete(token);
                reject('punch_timeout');
            }, config.CLOUD_FORWARD_WAIT_TIME_MAX);
            this._punchWaitMap.set(token, message => {
                clearTimeout(timer);
                this._punchWaitMap.delete(token);
                resolve(message);
            });
        });
    }

    _punch(token) {
        const punchStart = this._waitPunchStart(token);
        return sendPunchProbe(this.forward_endpoint, token, 'host')
            .then(localPort => punchStart.then(message => punchConnector.simultaneousConnect(localPort, message.peer_address, message.peer_port)))
            .then(socket => this.onConnection(socket, 'punch'));
    }

    stop() {
        this.stopped = true;
        this.control && this.control.destroy();
    }
}

/**
 * opens the short connection the forwarding node sees the port from, and
 * waits until the forwarding node closes it
 * @return {Promise<number>} the local port, free again
 */
export function sendPunchProbe(forwardEndpoint, token, role) {
    return connectNodeService(forwardEndpoint.node_address, forwardEndpoint.service_port, forwardEndpoint.node_id)
        .then(socket => new Promise((resolve, reject) => {
            const localPort = socket.localPort;
            const timer     = setTimeout(() => {
                socket.destroy();
                reject('punch_probe_timeout');
            }, config.CLOUD_FORWARD_WAIT_TIME_MAX);
            socket.on('error', _ => _);
            socket.once('close', () => {
                clearTimeout(timer);
                resolve(localPort);
            });
            writeLine(socket, {
                type: 'punch_probe',
                token,
                role
            });
            socket.resume();
        }));
}

/**
 * client: a connection to a host through its forwarding node
 * @param forward {node_id, node_address, service_port} of the offer's
 * endpoint
 * @param nodeID the host
 * @return {Promise<tls.TLSSocket>} the relayed connection; the client runs
 * its own tls with the host inside it
 */
export function connectThroughForward(forward, nodeID) {
    return connectNodeService(forward.node_address, forward.service_port, forward.node_id)
        .then(socket => {
            writeLine(socket, {
                type   : 'connect',
                node_id: nodeID
            });
            return readLine(socket).then(message => {
                if (message?.type !== 'connected') {
                    socket.destroy();
                    return Promise.reject(message?.error || 'forward_failed');
                }
                return socket;
            });
        });
}

/**
 * client: a direct connection to a host behind a router, by simultaneous
 * connect through its forwarding node
 * @return {Promise<net.Socket>}
 */
export function connectBySimultaneousOpen(forward, nodeID) {
    return connectNodeService(forward.node_address, forward.service_port, forward.node_id)
        .then(control => {
            control.on('error', _ => _);
            writeLine(control, {
                type   : 'punch',
                node_id: nodeID
            });
            return readLine(control)
                .then(message => {
                    if (message?.type !== 'punch_token') {
                        return Promise.reject(message?.error || 'punch_refused');
                    }
                    const punchStart = readLine(control);
                    return sendPunchProbe(forward, message.token, 'client')
                        .then(localPort => punchStart.then(startMessage => {
                            if (startMessage?.type !== 'punch_start') {
                                return Promise.reject(startMessage?.error || 'punch_refused');
                            }
                            return punchConnector.simultaneousConnect(localPort, startMessage.peer_address, startMessage.peer_port);
                        }));
                })
                .then(socket => {
                    control.destroy();
                    return socket;
                }, error => {
                    control.destroy();
                    return Promise.reject(error);
                });
        });
}
