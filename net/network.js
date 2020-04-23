import WebSocket, {Server} from 'ws';
import _ from 'lodash';
import config from '../core/config/config';
import database from '../database/database';
import eventBus from '../core/event-bus';
import crypto from 'crypto';
import async from 'async';
import peer from './peer';
import walletUtils from '../core/wallet/wallet-utils';
import signature from '../core/crypto/signature';
import objectHash from '../core/crypto/object-hash';

const WebSocketServer = Server;


class Network {
    constructor() {
        this._nodeList           = {};
        this._connectionRegistry = {};
        this._nodeRegistry       = {};
        this._ws                 = null;
        this.nodeID              = null;
        this.nodeConnectionID    = this.generateNewID();
        this._selfConnectionNode = new Set();
        this.initialized         = false;
        this.noop                = () => {
        };
    }

    get registeredClients() {
        return _.map(_.filter(_.values(this._nodeRegistry), listWS => listWS.length > 0), listWS => listWS[0]);
    }

    generateNewID() {
        return crypto.randomBytes(20).toString('hex');
    }

    setWebSocket(ws) {
        this._ws = ws;
    }

    getWebSocket() {
        return this._ws;
    }

    addNode(prefix, ip, port, id) {
        let url = prefix + ip + ':' + port;
        if (!this._nodeList[url]) {
            this._nodeList[url] = {
                node_prefix    : prefix,
                node_ip_address: ip,
                node_port      : port,
                node_id        : id
            };
        }
    }

    // general network functions
    _connectTo(prefix, ipAddress, port, id) {

        if (!prefix || !ipAddress || !port) {
            return Promise.resolve();
        }

        if (this.registeredClients.length >= config.NODE_CONNECTION_OUTBOUND_MAX) {
            console.log('[network outgoing] outbound connections maxed out, rejecting new client ');
            return Promise.resolve();
        }

        return new Promise((function(resolve, reject) {

            let url = prefix + ipAddress + ':' + port;

            if (!url || this._selfConnectionNode.has(url) || (id && this._nodeRegistry[id])) {
                return reject();
            }

            const ws = new WebSocket(url);

            ws.setMaxListeners(20); // avoid warning

            ws.once('open', () => {
                console.log('[network outgoing] Open connection to ' + url);

                ws.node                = url;
                ws.nodePort            = port;
                ws.nodePrefix          = prefix;
                ws.nodeIPAddress       = ipAddress;
                ws.createTime          = Date.now();
                ws.lastMessageTime     = ws.createTime;
                ws.outBound            = true;
                ws.nodeConnectionReady = false;
                console.log('[network outgoing] connected to ' + url + ', host ' + ws.nodeIPAddress);
                this._doHandshake(ws);
                resolve();
                eventBus.emit('node_status_update');
            });

            ws.on('close', () => {
                console.log('[network outgoing] close event, removing ' + url);

                // !ws.bOutbound means not connected yet. This is to
                // distinguish connection errors from later errors that occur
                // on open connection
                if (!ws.outBound) {
                    return reject();
                }

                this._unregisterWebsocket(ws);
                eventBus.emit('node_status_update');
            });

            ws.on('error', (e) => {
                console.log('[network outgoing] error in connection to nodes ' + e);
                // !ws.bOutbound means not connected yet. This is to
                // distinguish connection errors from later errors that occur
                // on open connection
                if (!ws.outBound) {
                    return reject();
                }

                this._unregisterWebsocket(ws);
                eventBus.emit('node_status_update');
            });

            ws.on('message', this._onWebsocketMessage);
            console.log('[network outgoing] connecting to node');

        }).bind(this));
    }

    _onWebsocketMessage(message) {

        const ws = this;

        if (ws.readyState !== ws.OPEN) {
            return;
        }

        ws.lastMessageTime = Date.now();

        let arrMessage;

        try {
            arrMessage = JSON.parse(message);
        }
        catch (e) {
            return console.log('[network] failed to json.parse message ' + message);
        }

        const message_type = arrMessage.type;
        const content      = arrMessage.content;

        eventBus.emit(message_type, content, ws);
    }

    getHostByNode(node) {
        node        = node.replace('::ffff:', '');
        let matches = node.match(/^wss?:\/\/(.*)$/i);
        if (matches) {
            node = matches[1];
        }
        matches = node.match(/^(.*?)[:\/]/);
        return matches ? matches[1] : node;
    }

    startAcceptingConnections() {
        let wss = new WebSocketServer({
            port: config.NODE_PORT
        });

        this.setWebSocket(wss);

        wss.on('connection', (ws, req) => {

            let ip;
            if (req.connection.remoteAddress) {
                ip = req.connection.remoteAddress.replace('::ffff:', '');
            }

            if (!ip) {
                console.log('[network income] no ip in accepted connection');
                ws.terminate();
                return;
            }

            if (req.headers['x-real-ip'] && (ip === '127.0.0.1' || ip.match(/^192\.168\./))) {
                // we are behind a proxy
                ip = req.headers['x-real-ip'];
            }

            ws.node                = config.WEBSOCKET_PROTOCOL + ip + ':' + req.connection.remotePort;
            ws.createTime          = Date.now();
            ws.lastMessageTime     = ws.createTime;
            ws.nodeConnectionReady = false;


            console.log('[network income] got connection from ' + ws.node + ', host ' + ip);

            if (this.registeredClients.length >= config.NODE_CONNECTION_INBOUND_MAX) {
                console.log('[network income] inbound connections maxed out, rejecting new client ' + ip);
                ws.close(1000, '[network income] inbound connections maxed out'); // 1001 doesn't work in cordova
                return;
            }

            ws.inBound = true;

            ws.on('message', this._onWebsocketMessage);

            ws.on('close', () => {
                console.log('[network income] client ' + ws.node + ' disconnected');
                this._unregisterWebsocket(ws);
                eventBus.emit('node_status_update');
            });

            ws.on('error', (e) => {
                console.log('[network income] error on client ' + ip + ': ' + e);
                ws.close(1000, 'received error');
                this._unregisterWebsocket(ws);
                eventBus.emit('node_status_update');
            });

            this._doHandshake(ws);
            eventBus.emit('node_status_update');
        });

        console.log('[network] wss running at port ' + config.NODE_PORT);
    }

    connectToNodes() {
        database.getRepository('node')
                .getNodes()
                .then((nodes) => {
                    async.eachSeries(nodes, (node, callback) => {
                        this.addNode(node.node_prefix, node.node_ip_address, node.node_port, node.node_id);
                        callback();
                    }, () => {
                        _.each(config.NODE_INITIAL_LIST, (url) => {
                            let matches   = url.match(/^(?<prefix>[A-z]+:\/\/)(?<ip_address>[\w|\d|.]+):(?<port>\d+)$/);
                            let prefix    = matches.groups['prefix'];
                            let ipAddress = matches.groups['ip_address'];
                            let port      = matches.groups['port'];
                            if ((!this._nodeList[url] || !this._nodeList[url].node_id) && (prefix && ipAddress && port)) {
                                this.addNode(prefix, ipAddress, port);
                            }
                        });
                        this.retryConnectToInactiveNodes();
                    });
                });
    }

    retryConnectToInactiveNodes() {
        if (!this.initialized) {
            return Promise.resolve();
        }
        let inactiveClients = new Set();
        _.each(_.keys(this._nodeList), url => {
            let node = this._nodeList[url];
            if (!this._nodeRegistry[node.node_id] && !this._selfConnectionNode.has(url)) {
                inactiveClients.add(node);
            }
        });

        console.log('[network] dead nodes size:', inactiveClients.size, ' | active nodes: (', this.registeredClients.length, '/', config.NODE_CONNECTION_INBOUND_MAX, ')');

        inactiveClients.forEach(node => {
            this._connectTo(node.node_prefix, node.node_ip_address, node.node_port, node.node_id).catch(this.noop);
        });
        return Promise.resolve();
    }


    _doHandshake(ws) {
        let node;
        if (config.NODE_PUBLIC) {
            let url = config.WEBSOCKET_PROTOCOL + config.NODE_HOST + ':' + config.NODE_PORT;
            node    = {
                node_prefix    : config.WEBSOCKET_PROTOCOL,
                node_ip_address: config.NODE_HOST,
                node_port      : config.NODE_PORT,
                node           : url
            };
        }
        else {
            node = {};
        }

        let challenge = Database.generateID(10);
        let content   = {
            node_id          : this.nodeID,
            node_network_test: config.MODE_TEST_NETWORK,
            connection_id    : this.nodeConnectionID, ...node,
            challenge
        };
        try {
            let payload        = {
                type: 'node_handshake',
                content
            };
            let data           = JSON.stringify(payload);
            let callbackCalled = false;
            eventBus.once('node_handshake_challenge_response:' + this.nodeConnectionID, function(eventData, _) {
                if (!callbackCalled) {
                    callbackCalled = true;
                    if (!signature.verify(objectHash.getHashBuffer(challenge), eventData.signature, eventData.public_key)) {
                        ws.terminate();
                    }
                }
            });

            ws.send(data);

            setTimeout(function() {
                if (!callbackCalled) {
                    callbackCalled = true;
                    eventBus.removeAllListeners('node_handshake_challenge_response:' + this.nodeConnectionID);
                    ws.terminate();
                }
            }, config.NETWORK_SHORT_TIME_WAIT_MAX);
        }
        catch (e) {
            console.log('[network warn]: try to send data over a closed connection.');
        }
    }

    _onNodeHandshake(registry, ws) {
        let nodeID      = registry.node_id;
        ws.nodeID       = nodeID;
        ws.connectionID = registry.connection_id;

        if (nodeID === this.nodeID) {
            ws.duplicated = true;

            if (ws.outBound) {
                this._selfConnectionNode.add(ws.node);
            }

            console.log('[network] closing self-connection');
            ws.terminate();
            return;
        }
        else if (!!registry.node_network_test !== config.MODE_TEST_NETWORK) {
            console.log('[network] closing connection from main network');
            ws.terminate();
            return;
        }

        if (this._registerWebsocketToNodeID(ws)) {
            this._registerWebsocketConnection(ws);
            if (ws.outBound) {
                let node                = {
                    node_prefix    : ws.nodePrefix,
                    node_ip_address: ws.nodeIPAddress,
                    node_port      : ws.nodePort,
                    node_id        : ws.nodeID
                };
                this._nodeList[ws.node] = node;
                database.getRepository('node')
                        .addNode(node)
                        .then(() => eventBus.emit('node_list_update'))
                        .catch(() => {
                        });
            }

            if (ws.inBound && registry.node_prefix && registry.node_ip_address && registry.node_port && registry.node) {
                let node                      = _.pick(registry, [
                    'node_prefix',
                    'node_ip_address',
                    'node_port',
                    'node_id',
                    'node'
                ]);
                this._nodeList[registry.node] = node;
                database.getRepository('node')
                        .addNode(node)
                        .then(() => eventBus.emit('node_list_update'))
                        .catch(() => {
                        });
            }

            const content = {
                public_key: this.nodePublicKey,
                signature: signature.sign(objectHash.getHashBuffer(registry.challenge), this.nodePrivateKey),
            }

            const payload = {
                type: 'node_handshake_challenge_response:' + registry.connection_id,
                content
            };

            let data    = JSON.stringify(payload);
            ws.send(data);
        }

        eventBus.emit('node_status_update');
    }

    _registerWebsocketToNodeID(ws) {

        if (this.registeredClients.length >= config.NODE_CONNECTION_INBOUND_MAX || this.registeredClients.length >= config.NODE_CONNECTION_OUTBOUND_MAX) {
            console.log('[network income] inbound connections maxed out, rejecting new client ');
            ws.close(1000, '[network income] inbound connections maxed out'); // 1001
            // doesn't
            // work
            // in
            // cordova
            return false;
        }

        let nodeID = ws.nodeID;
        if (this._nodeRegistry[nodeID]) {
            this._nodeRegistry[nodeID].push(ws);
        }
        else {
            console.log('[network] node id ' + nodeID + ' registered');
            this._nodeRegistry[nodeID] = [ws];
        }
        console.log('[network] node ' + ws.node + ' registered with node id ' + nodeID);
        return true;
    }

    getWebSocketByID(connectionID) {
        if (this._connectionRegistry[connectionID]) {
            return this._connectionRegistry[connectionID][0];
        }
        return null;
    }

    _registerWebsocketConnection(ws) {
        let connectionID = ws.connectionID;
        if (this._connectionRegistry[connectionID]) {
            this._connectionRegistry[connectionID].push(ws);
            console.log('[network] node ' + ws.node + ' already registered with connection id ' + connectionID);
            return ws.close(1000, 'self-connection');
        }
        else {
            console.log('[network] node ' + ws.node + ' registered with connection id ' + connectionID);
            this._connectionRegistry[connectionID] = [ws];
            setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.nodeConnectionReady = true;
                }
            }, 1500);
        }
    }

    _unregisterWebsocket(ws) {
        ws.nodeID && _.pull(this._nodeRegistry[ws.nodeID], ws);
        if (this._nodeRegistry[ws.nodeID] && this._nodeRegistry[ws.nodeID].length === 0) {
            delete this._nodeRegistry[ws.nodeID];
        }

        ws.connectionID && _.pull(this._connectionRegistry[ws.connectionID], ws);
        if (this._connectionRegistry[ws.connectionID] && this._connectionRegistry[ws.connectionID].length === 0) {
            delete this._connectionRegistry[ws.connectionID];
        }
    }

    _onGetNodeAddress(data, ws) {
        if (data.request_id && ws._socket && ws._socket.remoteAddress) {
            peer.sendNodeAddress(ws._socket.remoteAddress.replace('::ffff:', ''), data.request_id, ws);
        }
    }

    _initializeServer() {
        console.log('node id : ', this.nodeID);
        this.startAcceptingConnections();
        this.connectToNodes();
        this.initialized = true;
        eventBus.on('node_handshake', this._onNodeHandshake.bind(this));
        eventBus.on('node_address_request', this._onGetNodeAddress.bind(this));
    }

    initialize() {
        this.nodeConnectionID = this.generateNewID();
        return new Promise(resolve => {
            console.log('[network] starting network');
            walletUtils.loadNodeKey()
                       .then(key => {
                           const data = walletUtils.deriveAddressFromKey(key, 0, 0);
                           this.nodePrivateKey = key;
                           this.nodePublicKey = data.address_attribute.public_key
                           this.nodeID = data.address;
                           this._initializeServer();
                           resolve();
                       })
                       .catch(() => {
                           let key = walletUtils.generateNodeKey();
                           walletUtils.storeNodeKey(key)
                                      .then(key => {
                                          const data = walletUtils.deriveAddressFromKey(key, 0, 0);
                                          this.nodePrivateKey = walletUtils.derivePrivateKey(key, 0, 0);
                                          this.nodePublicKey = data.address_attribute.public_key
                                          this.nodeID = data.address;
                                          this._initializeServer();
                                          resolve();
                                      });
                       });
        });
    }

    stop() {
        this.initialized = false;
        eventBus.removeAllListeners('node_handshake');
        eventBus.removeAllListeners('node_address_request');
        this.getWebSocket() && this.getWebSocket().close();
        _.each(_.keys(this._nodeRegistry), id => _.each(this._nodeRegistry[id], ws => ws && ws.close && ws.close()));
        this._nodeRegistry       = {};
        this._connectionRegistry = {};
    }
}


export default new Network();
