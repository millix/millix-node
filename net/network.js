import WebSocket, {Server} from 'ws';
import _ from 'lodash';
import config from '../core/config/config';
import database from '../database/database';
import eventBus from '../core/event-bus';
import crypto from 'crypto';
import async from 'async';
import peer from './peer';
import walletUtils from '../core/wallet/wallet-utils';
import https from 'https';
import base58 from 'bs58';
import publicIp from 'public-ip';

const WebSocketServer = Server;


class Network {
    constructor() {
        this._nodeList                            = {};
        this._connectionRegistry                  = {};
        this._nodeRegistry                        = {};
        this._inboundRegistry                     = {};
        this._outboundRegistry                    = {};
        this._bidirectionaOutboundConnectionCount = 0;
        this._bidirectionaInboundConnectionCount  = 0;
        this._ws                                  = null;
        this.nodeID                               = null;
        this.nodeConnectionID                     = this.generateNewID();
        this._selfConnectionNode                  = new Set();
        this.initialized                          = false;
        this.noop                                 = () => {
        };
    }

    get registeredClients() {
        return _.map(_.filter(_.values(this._nodeRegistry), listWS => listWS.length > 0), listWS => listWS[0]);
    }

    get outboundClients() {
        return _.map(_.filter(_.values(this._outboundRegistry), listWS => listWS.length > 0), listWS => listWS[0]);
    }

    get inboundClients() {
        return _.map(_.filter(_.values(this._inboundRegistry), listWS => listWS.length > 0), listWS => listWS[0]);
    }

    get nodeList() {
        return this._nodeList;
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

    addNode(prefix, ip, port, portApi, id) {
        let url = prefix + ip + ':' + port;
        if (!this._nodeList[url]) {
            this._nodeList[url] = {
                node_prefix    : prefix,
                node_ip_address: ip,
                node_port      : port,
                node_port_api  : portApi,
                node_id        : id
            };
            return true;
        }
        return false;
    }

    // general network functions
    _connectTo(prefix, ipAddress, port, portApi, id) {

        if (!prefix || !ipAddress || !port || portApi === undefined) {
            return Promise.resolve();
        }
        else if (config.NODE_CONNECTION_OUTBOUND_WHITELIST.length > 0 && id && !config.NODE_CONNECTION_OUTBOUND_WHITELIST.includes(id)) {
            console.log('[network warn]: node id not in NODE_CONNECTION_OUTBOUND_WHITELIST');
            return Promise.resolve();
        }

        if (!this.hasOutboundConnectionsSlotAvailable()) {
            console.log('[network outgoing] outbound connections maxed out, rejecting new client ');
            return Promise.resolve();
        }

        return new Promise((function(resolve, reject) {

            let url = prefix + ipAddress + ':' + port;

            if (!url || this._selfConnectionNode.has(url) || (id && this._nodeRegistry[id])) {
                return reject(this._selfConnectionNode.has(url) ? 'self-connection' : `node ${id} is already connected`);
            }

            const ws = new WebSocket(url, {
                rejectUnauthorized: false,
                handshakeTimeout  : 10000
            });

            ws.setMaxListeners(20); // avoid warning
            ws.createTime = Date.now();

            ws.once('open', () => {
                console.log('[network outgoing] Open connection to ' + url);

                ws.node                = url;
                ws.nodePort            = port;
                ws.nodePortApi         = portApi;
                ws.nodePrefix          = prefix;
                ws.nodeIPAddress       = ipAddress;
                ws.lastMessageTime     = ws.createTime;
                ws.outBound            = true;
                ws.nodeConnectionReady = false;
                ws.bidirectional       = false;
                console.log('[network outgoing] connected to ' + url + ', host ' + ws.nodeIPAddress);
                this._doHandshake(ws).then(_ => _);
                resolve();
            });

            ws.on('close', () => {
                console.log('[network outgoing] close event, removing ' + url);

                // !ws.bOutbound means not connected yet. This is to
                // distinguish connection errors from later errors that occur
                // on open connection
                if (!ws.outBound) {
                    return reject('client closed the connection');
                }

                this._unregisterWebsocket(ws);
            });

            ws.on('error', (e) => {
                console.log('[network outgoing] error in connection to nodes ' + e + '. disconnected after ' + (Date.now() - ws.createTime) + 'ms.');
                // !ws.bOutbound means not connected yet. This is to
                // distinguish connection errors from later errors that occur
                // on open connection
                if (!ws.outBound) {
                    return reject('there was an error in the connection,' + e);
                }

                this._unregisterWebsocket(ws);
            });

            ws.on('message', this._onWebsocketMessage.bind(this, ws));
            console.log('[network outgoing] connecting to node');

        }).bind(this));
    }

    _onWebsocketMessage(ws, message) {

        if (ws.readyState !== ws.OPEN) {
            return;
        }

        ws.lastMessageTime = Date.now();

        let jsonMessage;

        try {
            jsonMessage = JSON.parse(message);
        }
        catch (e) {
            return console.log('[network] failed to parse json message ' + message);
        }

        const messageType = jsonMessage.type;
        const content     = jsonMessage.content;

        if (ws.outBound && !ws.bidirectional && this.shouldBlockMessage(messageType)) {
            return;
        }

        eventBus.emit(messageType, content, ws);
    }

    shouldBlockMessage(messageType) {
        return !!/.*_(request|sync|allocate)$/g.exec(messageType);
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

    startAcceptingConnections(certificatePem, certificatePrivateKeyPem) {
        // starting the server
        const server = https.createServer({
            key      : certificatePrivateKeyPem,
            cert     : certificatePem,
            ecdhCurve: 'prime256v1'
        });

        server.listen(config.NODE_PORT);

        let wss = new WebSocketServer({server});

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
            ws.bidirectional       = false;


            console.log('[network income] got connection from ' + ws.node + ', host ' + ip);

            if (!this.hasInboundConnectionsSlotAvailable()) {
                console.log('[network income] inbound connections maxed out, rejecting new client ' + ip);
                ws.close(1000, '[network income] inbound connections maxed out'); // 1001 doesn't work in cordova
                return;
            }

            ws.inBound = true;

            ws.on('message', this._onWebsocketMessage.bind(this, ws));

            ws.on('close', () => {
                console.log('[network income] client ' + ws.node + ' disconnected');
                this._unregisterWebsocket(ws);
            });

            ws.on('error', (e) => {
                console.log('[network income] error on client ' + ip + ': ' + e);
                ws.close(1000, 'received error');
                this._unregisterWebsocket(ws);
            });

            this._doHandshake(ws, true);
        });

        console.log('[network] wss running at port ' + config.NODE_PORT);
    }

    connectToNodes() {
        database.getRepository('node')
                .listNodes()
                .then((nodes) => {
                    async.eachSeries(nodes, (node, callback) => {
                        this.addNode(node.node_prefix, node.node_ip_address, node.node_port, node.node_port_api, node.node_id);
                        callback();
                    }, () => {
                        _.each(config.NODE_INITIAL_LIST, ({url, port_api: portApi}) => {
                            let matches   = url.match(/^(?<prefix>[A-z]+:\/\/)(?<ip_address>[^:]+):(?<port>\d+)$/);
                            let prefix    = matches.groups['prefix'];
                            let ipAddress = matches.groups['ip_address'];
                            let port      = matches.groups['port'];
                            if ((!this._nodeList[url] || !this._nodeList[url].node_id) && (prefix && ipAddress && port && portApi)) {
                                this.addNode(prefix, ipAddress, port, portApi);
                            }
                        });
                        this.retryConnectToInactiveNodes().then(_ => _).catch(_ => _);
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

        console.log('[network] dead nodes size:', inactiveClients.size, ' | active nodes: (', this.registeredClients.length, '/', config.NODE_CONNECTION_INBOUND_MAX + config.NODE_CONNECTION_OUTBOUND_MAX, ')');

        inactiveClients.forEach(node => {
            this._connectTo(node.node_prefix, node.node_ip_address, node.node_port, node.node_port_api, node.node_id).catch(this.noop);
        });
        return Promise.resolve();
    }

    getNodeIdFromWebSocket(ws) {
        const peerCertificate = ws._socket.getPeerCertificate();
        if (!peerCertificate) {
            return null;
        }
        return walletUtils.getNodeIdFromCertificate(peerCertificate.raw.toString('hex'), 'hex');
    }

    getNodePublicKeyFromWebSocket(ws) {
        const peerCertificate = ws._socket.getPeerCertificate();
        if (!peerCertificate) {
            return null;
        }
        return walletUtils.getNodePublicKeyFromCertificate(peerCertificate.raw.toString('hex'), 'hex');
    }

    _doHandshake(ws, isInboundConnection) {
        return new Promise((resolve) => {
            let node;

            let url = config.WEBSOCKET_PROTOCOL + this.nodePublicIp + ':' + config.NODE_PORT;
            node    = {
                node_prefix    : config.WEBSOCKET_PROTOCOL,
                node_ip_address: this.nodePublicIp,
                node_port      : config.NODE_PORT,
                node_port_api  : config.NODE_PORT_API,
                node           : url
            };

            if (!isInboundConnection) {
                // force node registration on new inbound node connection
                let peerNodeID;
                try {
                    peerNodeID = this.getNodeIdFromWebSocket(ws);
                    if (!peerNodeID) {
                        throw Error('cannot read node id from certificate');
                    }
                    ws.nodeID = peerNodeID;
                }
                catch (e) {
                    console.log('[network warn]: cannot get node identity.' + e.message);
                    ws.terminate();
                    return;
                }

                database.getRepository('node')
                        .getNodeAttribute(peerNodeID, 'node_public_key')
                        .then(_ => {
                            let payload = {
                                type   : 'node_handshake',
                                content: {
                                    node_id              : this.nodeID,
                                    node_network_test    : config.MODE_TEST_NETWORK,
                                    connection_id        : this.nodeConnectionID,
                                    registration_required: false,
                                    ...node
                                }
                            };
                            resolve(payload);
                        })
                        .catch(() => {
                            console.log('[network warn]: node public key not found... require node registration during handshake.');
                            let payload = {
                                type   : 'node_handshake',
                                content: {
                                    node_id              : this.nodeID,
                                    node_network_test    : config.MODE_TEST_NETWORK,
                                    connection_id        : this.nodeConnectionID,
                                    registration_required: true,
                                    ...node
                                }
                            };
                            resolve(payload);
                        });
            }
            else {
                let payload = {
                    type   : 'node_handshake',
                    content: {
                        node_id              : this.nodeID,
                        node_network_test    : config.MODE_TEST_NETWORK,
                        connection_id        : this.nodeConnectionID,
                        registration_required: true,

                        ...node
                    }
                };
                resolve(payload);
            }
        }).then(payload => {
            let callbackCalled = false;
            eventBus.removeAllListeners('node_handshake_challenge_response:' + this.nodeConnectionID);
            eventBus.once('node_handshake_challenge_response:' + this.nodeConnectionID, (eventData, _) => {
                if (!callbackCalled) {
                    callbackCalled       = true;
                    let peerNodeID;
                    const nodeRepository = database.getRepository('node');

                    if (payload.content.registration_required) {
                        peerNodeID = eventData.node_id;
                        if (!walletUtils.isValidNodeIdentity(peerNodeID, eventData.public_key, this.nodeID, eventData.signature)) {
                            console.log('[network warn]: invalid node identity.');
                            ws.terminate();
                            return;
                        }
                        else if (ws.inBound && config.NODE_CONNECTION_INBOUND_WHITELIST.length > 0 && !config.NODE_CONNECTION_INBOUND_WHITELIST.includes(peerNodeID)) {
                            console.log('[network warn]: node id not in NODE_CONNECTION_INBOUND_WHITELIST');
                            ws.terminate();
                            return;
                        }
                        ws.nodeID = peerNodeID;
                        nodeRepository.addNodeAttribute(peerNodeID, 'node_public_key', eventData.public_key)
                                      .catch(() => {
                                          console.log('[network warn]: registration error.');
                                          ws.terminate();
                                      });
                    }
                    else {
                        const peerNodeID  = ws.nodeID;
                        let nodePublicKey = this.getNodePublicKeyFromWebSocket(ws);
                        if (!nodePublicKey) {
                            console.log('[network warn]: cannot get node identity from certificate. ');
                            ws.terminate();
                            return;
                        }
                        nodeRepository.addNodeAttribute(peerNodeID, 'node_public_key', nodePublicKey)
                                      .catch(() => {
                                          console.log('[network warn]: registration error.');
                                          ws.terminate();
                                      });
                    }
                    // set connection ready
                    let extra = {};

                    if (ws.inBound && this.hasOutboundConnectionsSlotAvailable() && !(config.NODE_CONNECTION_OUTBOUND_WHITELIST.length > 0 && !config.NODE_CONNECTION_OUTBOUND_WHITELIST.includes(peerNodeID))) {
                        ws.reservedOutboundSlot = true;
                        this._bidirectionaInboundConnectionCount++;
                        extra['enable_inbound_stream'] = true;
                    }

                    peer.sendConnectionReady(extra, ws);

                    // request peer attributes
                    peer.nodeAttributeRequest({
                        node_id       : peerNodeID,
                        attribute_type: 'shard_protocol'
                    }, ws);

                    peer.nodeAttributeRequest({
                        node_id       : peerNodeID,
                        attribute_type: 'transaction_count'
                    }, ws);

                    // send peer list to the new node
                    peer.sendNodeList(ws);

                    eventBus.emit('peer_connection_new', ws);
                    eventBus.emit('node_status_update');
                }
            });

            ws.send(JSON.stringify(payload));

            setTimeout(function() {
                if (!callbackCalled) {
                    callbackCalled = true;
                    eventBus.removeAllListeners('node_handshake_challenge_response:' + this.nodeConnectionID);
                    ws.terminate();
                }
            }, config.NETWORK_LONG_TIME_WAIT_MAX * 2);
        }).catch(e => {
            console.log('[network warn]: error on connection handshake.');
            ws.terminate();
        });
    }

    _onNodeHandshake(registry, ws) {
        ws.nodeID       = ws.nodeID || registry.node_id;
        ws.connectionID = registry.connection_id;

        if (ws.nodeID === this.nodeID) {
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
                    node_port_api  : ws.nodePortApi,
                    node_id        : ws.nodeID
                };
                this._nodeList[ws.node] = node;
                database.getRepository('node')
                        .addNode({
                            ...node,
                            status: 2
                        })
                        .then(() => eventBus.emit('node_list_update'))
                        .catch(() => {
                        });
            }

            if (ws.inBound && registry.node_prefix && registry.node_ip_address && registry.node_port && registry.node_port_api && registry.node) {
                let node                      = _.pick(registry, [
                    'node_prefix',
                    'node_ip_address',
                    'node_port',
                    'node_port_api',
                    'node_id',
                    'node'
                ]);
                ws.node                       = registry.node;
                this._nodeList[registry.node] = node;
                database.getRepository('node')
                        .addNode({
                            ...node,
                            status: 2
                        })
                        .then(() => eventBus.emit('node_list_update'))
                        .catch(() => {
                        });
            }

            const content = {};
            if (registry.registration_required) {
                content['node_id']    = this.nodeID;
                content['public_key'] = this.nodePublicKey;
                content['signature']  = walletUtils.signMessage(this.nodePrivateKey, registry.node_id);
            }


            const payload = {
                type: 'node_handshake_challenge_response:' + registry.connection_id,
                content
            };

            try {
                ws.send(JSON.stringify(payload));
            }
            catch (e) {
                console.log('[network warn]: try to send data over a closed connection.');
                ws.terminate();
            }
        }
    }

    hasInboundConnectionsSlotAvailable() {
        return (_.keys(this._inboundRegistry).length + this._bidirectionaOutboundConnectionCount) < config.NODE_CONNECTION_INBOUND_MAX;
    }

    hasOutboundConnectionsSlotAvailable() {
        return (_.keys(this._outboundRegistry).length + this._bidirectionaInboundConnectionCount) < config.NODE_CONNECTION_OUTBOUND_MAX;
    }

    _registerWebsocketToNodeID(ws) {

        if (ws.inBound && !this.hasInboundConnectionsSlotAvailable()) {
            console.log('[network inbound] connections maxed out, rejecting new client ');
            ws.close(1000, '[network inbound] connections maxed out');
            return false;
        }
        else if (ws.outBound && !this.hasOutboundConnectionsSlotAvailable()) {
            console.log('[network outbound] connections maxed out, rejecting new client ');
            ws.close(1000, '[network outbound] connections maxed out');
            return false;
        }

        let nodeID = ws.nodeID;
        // global registry
        if (this._nodeRegistry[nodeID]) {
            this._nodeRegistry[nodeID].push(ws);
        }
        else {
            console.log('[network] node id ' + nodeID + ' registered');
            this._nodeRegistry[nodeID] = [ws];
        }

        // inbound or outbound registry
        const registry = ws.inBound ? this._inboundRegistry : this._outboundRegistry;
        if (registry[nodeID]) {
            registry[nodeID].push(ws);
        }
        else {
            registry[nodeID] = [ws];
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
        }
    }

    _unregisterWebsocket(ws) {
        if (ws.nodeID) {
            // remove from global registry
            _.pull(this._nodeRegistry[ws.nodeID], ws);
            if (this._nodeRegistry[ws.nodeID] && this._nodeRegistry[ws.nodeID].length === 0) {
                delete this._nodeRegistry[ws.nodeID];
            }

            // remove from inbound or outbound registry
            const registry = ws.inBound ? this._inboundRegistry : this._outboundRegistry;
            _.pull(registry[ws.nodeID], ws);
            if (registry[ws.nodeID] && registry[ws.nodeID].length === 0) {
                delete registry[ws.nodeID];
            }

            database.getRepository('node')
                    .updateNode({
                        ...this._nodeList[ws.node],
                        status: !this._nodeRegistry[ws.nodeID] ? 1 : 2
                    });
        }

        // remove from connection registry
        ws.connectionID && _.pull(this._connectionRegistry[ws.connectionID], ws);
        if (this._connectionRegistry[ws.connectionID] && this._connectionRegistry[ws.connectionID].length === 0) {
            delete this._connectionRegistry[ws.connectionID];
        }
        if (ws.onUnregister) {
            ws.onUnregister();
        }
        eventBus.emit('peer_connection_closed', ws);
        eventBus.emit('node_status_update');
    }

    _onGetNodeAddress(data, ws) {
        if (data.request_id && ws._socket && ws._socket.remoteAddress) {
            peer.sendNodeAddress(ws._socket.remoteAddress.replace('::ffff:', ''), data.request_id, ws);
        }
    }

    _onConnectionReady(content, ws) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.nodeConnectionState = !ws.nodeConnectionState ? 'waiting' : 'open';
            if (ws.nodeConnectionState === 'open') {
                // set connection ready
                ws.nodeConnectionReady = true;

                // request node attributes
                peer.nodeAttributeRequest({
                    node_id       : ws.nodeID,
                    attribute_type: 'shard_protocol'
                }, ws);

                peer.nodeAttributeRequest({
                    node_id       : ws.nodeID,
                    attribute_type: 'transaction_count'
                }, ws);

                // send peer list to the new node
                peer.sendNodeList(ws);

                eventBus.emit('peer_connection_new', ws);
                eventBus.emit('node_status_update');
            }

            if (content && content.enable_inbound_stream === true) {
                if (ws.outBound && this.hasInboundConnectionsSlotAvailable() && !(config.NODE_CONNECTION_INBOUND_WHITELIST.length > 0 && !config.NODE_CONNECTION_INBOUND_WHITELIST.includes(ws.nodeID))) {
                    ws.bidirectional = true;
                    this._bidirectionaOutboundConnectionCount++;
                    peer.replyInboundStreamRequest(true, ws);
                }
                else {
                    ws.bidirectional = true;
                    peer.replyInboundStreamRequest(false, ws);
                }
            }
        }
    }

    _onInboundStreamResponse(content, ws) {
        if (ws.reservedOutboundSlot) {
            if (content.inbound_stream_enabled === true) {
                ws.bidirectional = true;
            }
            else {
                ws.bidirectional = false;
                this._bidirectionaInboundConnectionCount--;
            }
            ws.reservedOutboundSlot = false;
        }
    }

    _initializeServer(certificatePem, certificatePrivateKeyPem) {
        console.log('node id : ', this.nodeID);
        this.startAcceptingConnections(certificatePem, certificatePrivateKeyPem);
        this.connectToNodes();
        this.initialized = true;
        eventBus.on('node_handshake', this._onNodeHandshake.bind(this));
        eventBus.on('node_address_request', this._onGetNodeAddress.bind(this));
        eventBus.on('connection_ready', this._onConnectionReady.bind(this));
        eventBus.on('inbound_stream_response', this._onInboundStreamResponse.bind(this));
    }

    initialize() {
        this.nodeConnectionID = this.generateNewID();
        return new Promise(resolve => {
            console.log('[network] starting network');
            database.getRepository('node')
                    .resetNodeState()
                    .then(() => publicIp.v4())
                    .then(ip => {
                        console.log('[network] node public-ip', ip);
                        this.nodePublicIp = ip;
                        walletUtils.loadNodeKeyAndCertificate()
                                   .then(({certificate_private_key_pem: certificatePrivateKeyPem, certificate_pem: certificatePem, node_private_key: privateKey, node_public_key: publicKey}) => {
                                       this.nodePrivateKey = privateKey;
                                       this.nodePublicKey  = base58.encode(publicKey.toBuffer());
                                       this.nodeID         = walletUtils.getNodeIdFromPublicKey(this.nodePublicKey);
                                       this._initializeServer(certificatePem, certificatePrivateKeyPem);
                                       resolve();
                                   });
                    })
                    .catch(() => {
                        setTimeout(() => this.initialize().then(() => resolve()), 1000);
                    });
        });
    }

    stop() {
        this.initialized = false;
        eventBus.removeAllListeners('node_handshake');
        eventBus.removeAllListeners('node_address_request');
        eventBus.removeAllListeners('connection_ready');
        eventBus.removeAllListeners('inbound_stream_response');
        const wss = this.getWebSocket();
        if (wss) {
            wss._server.close();
            wss.close();
        }

        // clean inbound and outbound registries
        this._inboundRegistry  = {};
        this._outboundRegistry = {};
        // disconnect websocket and clean global registry
        _.each(_.keys(this._nodeRegistry), id => _.each(this._nodeRegistry[id], ws => ws && ws.close && ws.close()));
        this._nodeRegistry       = {};
        // clean connection registry
        this._connectionRegistry = {};
    }
}


export default new Network();
