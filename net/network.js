import WebSocket, {Server} from 'ws';
import _ from 'lodash';
import config from '../core/config/config';
import database from '../database/database';
import eventBus from '../core/event-bus';
import crypto from 'crypto';
import async from 'async';
import peer from './peer';
import walletUtils from '../core/wallet/wallet-utils';
import objectHash from '../core/crypto/object-hash';
import wallet from '../core/wallet/wallet';
import https from 'https';
import base58 from 'bs58';
import publicIp from 'public-ip';
import util from 'util';
import dns from 'dns';
import DHT from 'bittorrent-dht';
import signature from '../core/crypto/signature';
import NatAPI from 'nat-api';

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
        this.dht                                  = null;
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

    getNodeSocket(nodeID) {
        return _.first(this._nodeRegistry[nodeID]);
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
            const now           = Math.floor(Date.now() / 1000);
            this._nodeList[url] = {
                node_prefix  : prefix,
                node_address : ip,
                node_port    : port,
                node_port_api: portApi,
                node_id      : id,
                create_date  : now,
                update_date  : now,
                status       : -1
            };
            return true;
        }
        return false;
    }

    // general network functions
    _connectTo(prefix, ipAddress, port, portApi, id) {

        if (this._nodeRegistry[id] && this._nodeRegistry[id][0]) {
            return Promise.resolve(this._nodeRegistry[id][0]);
        }
        else if (!prefix || !ipAddress || !port || portApi === undefined) {
            return Promise.reject();
        }
        else if (config.NODE_CONNECTION_OUTBOUND_WHITELIST.length > 0 && id && !config.NODE_CONNECTION_OUTBOUND_WHITELIST.includes(id)) {
            console.log('[network warn]: node id not in NODE_CONNECTION_OUTBOUND_WHITELIST');
            return Promise.reject();
        }

        if (!this.hasOutboundConnectionsSlotAvailable()) {
            console.log('[network outgoing] outbound connections maxed out, rejecting new client ');
            return Promise.reject();
        }

        return new Promise((resolve, reject) => {

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
                this._doHandshake(ws)
                    .then(() => resolve(ws))
                    .catch(reject);
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

        });
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

        server.listen(config.NODE_PORT, config.NODE_BIND_IP);

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
                    async.eachSeries(_.shuffle(nodes), (node, callback) => {
                        this.addNode(node.node_prefix, node.node_address, node.node_port, node.node_port_api, node.node_id);
                        callback();
                    }, () => {
                        _.each(_.shuffle(config.NODE_INITIAL_LIST), ({
                                                                         host,
                                                                         port_protocol: port,
                                                                         port_api     : portApi
                                                                     }) => {
                            let prefix = config.WEBSOCKET_PROTOCOL;
                            let url    = `${prefix}://${host}:${port}`;
                            if ((!this._nodeList[url] || !this._nodeList[url].node_id) && (prefix && host && port && portApi)) {
                                this.addNode(prefix, host, port, portApi);
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

        return new Promise(resolve => {
            async.eachLimit(_.shuffle(Array.from(inactiveClients)), 4, (node, callback) => {
                this._connectTo(node.node_prefix, node.node_address, node.node_port, node.node_port_api, node.node_id)
                    .then(() => setTimeout(callback, 1000))
                    .catch(() => setTimeout(callback, 1000));
            }, () => resolve());
        });
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
                node_prefix  : config.WEBSOCKET_PROTOCOL,
                node_address : this.nodePublicIp,
                node_port    : config.NODE_PORT,
                node_port_api: config.NODE_PORT_API,
                node         : url
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
                        .then(attribute => {
                            if (!attribute) {
                                return Promise.reject();
                            }
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
            return new Promise((resolve, reject) => {
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
                                return reject('invalid_node_identity');
                            }
                            else if (ws.inBound && config.NODE_CONNECTION_INBOUND_WHITELIST.length > 0 && !config.NODE_CONNECTION_INBOUND_WHITELIST.includes(peerNodeID)) {
                                console.log('[network warn]: node id not in NODE_CONNECTION_INBOUND_WHITELIST');
                                ws.terminate();
                                return reject('inbound_connection_blocked');
                            }
                            ws.nodeID = peerNodeID;
                            nodeRepository.addNodeAttribute(peerNodeID, 'node_public_key', eventData.public_key)
                                          .catch(() => {
                                              console.log('[network warn]: registration error.');
                                          });
                        }
                        else {
                            const peerNodeID  = ws.nodeID;
                            let nodePublicKey = this.getNodePublicKeyFromWebSocket(ws);
                            if (!nodePublicKey) {
                                console.log('[network warn]: cannot get node identity from certificate. ');
                                ws.terminate();
                                return reject('invalid_node_identity');
                            }
                            nodeRepository.addNodeAttribute(peerNodeID, 'node_public_key', nodePublicKey)
                                          .catch(() => {
                                              console.log('[network warn]: registration error.');
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
                        this._requestAllNodeAttribute(peerNodeID, ws);
                        // send peer list to the new node
                        peer.sendNodeList(ws).then(_ => _);

                        database.getRepository('node')
                                .addNode({
                                    ...this.nodeList[ws.node],
                                    status: 2
                                })
                                .then(() => eventBus.emit('node_list_update'))
                                .catch(() => eventBus.emit('node_list_update'));

                        eventBus.emit('peer_connection_new', ws);
                        eventBus.emit('node_status_update');
                        resolve();
                    }
                });

                ws.readyState === ws.OPEN && ws.send(JSON.stringify(payload));

                setTimeout(function() {
                    if (!callbackCalled) {
                        callbackCalled = true;
                        eventBus.removeAllListeners('node_handshake_challenge_response:' + this.nodeConnectionID);
                        ws.terminate();
                        reject('handsharke_timeout');
                    }
                }, config.NETWORK_LONG_TIME_WAIT_MAX * 2);
            });
        }).catch(e => {
            console.log('[network warn]: error on connection handshake.', e);
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
                const now               = Math.floor(Date.now() / 1000);
                let node                = {
                    node_prefix  : ws.nodePrefix,
                    node_address : ws.nodeIPAddress,
                    node_port    : parseInt(ws.nodePort),
                    node_port_api: parseInt(ws.nodePortApi),
                    node_id      : ws.nodeID,
                    create_date  : now,
                    update_date  : now,
                    status       : -1
                };
                this._nodeList[ws.node] = node;
            }

            if (ws.inBound && registry.node_prefix && registry.node_address && registry.node_port && registry.node_port_api && registry.node) {
                let node                      = _.pick(registry, [
                    'node_prefix',
                    'node_address',
                    'node_port',
                    'node_port_api',
                    'node_id',
                    'node'
                ]);
                const now                     = Math.floor(Date.now() / 1000);
                node['create_date']           = now;
                node['update_date']           = now;
                node['status']                = -1;
                ws.node                       = registry.node;
                this._nodeList[registry.node] = node;
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
                database.getRepository('node')
                        .updateNode({
                            ...this._nodeList[ws.node],
                            status: 1
                        }).then(_ => _);
            }

            // remove from inbound or outbound registry
            const registry = ws.inBound ? this._inboundRegistry : this._outboundRegistry;
            _.pull(registry[ws.nodeID], ws);
            if (registry[ws.nodeID] && registry[ws.nodeID].length === 0) {
                delete registry[ws.nodeID];
            }
        }

        // update bidirectional stream slots
        if (ws.bidirectional || ws.reservedOutboundSlot) {
            if (ws.inBound) {
                this._bidirectionaInboundConnectionCount--;
            }
            else {
                this._bidirectionaOutboundConnectionCount--;
            }
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

    _requestAllNodeAttribute(nodeID, ws) {
        peer.nodeAttributeRequest({
            node_id       : nodeID,
            attribute_type: 'shard_protocol'
        }, ws);

        peer.nodeAttributeRequest({
            node_id       : nodeID,
            attribute_type: 'transaction_count'
        }, ws);

        peer.nodeAttributeRequest({
            node_id       : nodeID,
            attribute_type: 'peer_count'
        }, ws);

        peer.nodeAttributeRequest({
            node_id       : nodeID,
            attribute_type: 'job_list'
        }, ws);

        peer.nodeAttributeRequest({
            node_id       : nodeID,
            attribute_type: 'address_default'
        }, ws);

        peer.nodeAttributeRequest({
            node_id       : nodeID,
            attribute_type: 'node_about'
        }, ws);

        peer.nodeAttributeRequest({
            node_id       : nodeID,
            attribute_type: 'peer_connection'
        }, ws);

        peer.nodeAttributeRequest({
            node_id       : nodeID,
            attribute_type: 'transaction_fee'
        }, ws);

    }

    _onConnectionReady(content, ws) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.nodeConnectionState = !ws.nodeConnectionState ? 'waiting' : 'open';
            if (ws.nodeConnectionState === 'open') {
                // set connection ready
                ws.nodeConnectionReady = true;

                // request node attributes
                this._requestAllNodeAttribute(ws.nodeID, ws);

                // send peer list to the new node
                peer.sendNodeList(ws);

                database.getRepository('node')
                        .addNode({
                            ...this.nodeList[ws.node],
                            status: 2
                        })
                        .then(() => eventBus.emit('node_list_update'))
                        .catch(() => eventBus.emit('node_list_update'));

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
                    ws.bidirectional = false;
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

    doPortMapping() {
        const portMapper = util.promisify(this.natAPI.map);
        return portMapper({
            publicPort : config.NODE_PORT,
            privatePort: config.NODE_PORT,
            protocol   : 'TCP',
            description: 'millix network'
        })
            .then(() => portMapper({
                publicPort : config.NODE_PORT_API,
                privatePort: config.NODE_PORT_API,
                protocol   : 'TCP',
                description: 'millix api'
            }))
            .then(() => portMapper({
                publicPort : config.NODE_PORT_DISCOVERY,
                privatePort: config.NODE_PORT_DISCOVERY,
                protocol   : 'UDP',
                description: 'millix discovery'
            }));
    }

    _initializeServer(certificatePem, certificatePrivateKeyPem) {
        console.log('node id : ', this.nodeID);
        this.natAPI = new NatAPI();
        this.doPortMapping()
            .then(() => this.startAcceptingConnections(certificatePem, certificatePrivateKeyPem))
            .catch(() => this.startAcceptingConnections(certificatePem, certificatePrivateKeyPem));

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
                    .then(() => {
                        if (config.NODE_HOST_FORCE) {
                            return config.NODE_HOST;
                        }
                        else {
                            return publicIp.v4()
                                           .then(ip => {
                                               let dnsResolve4 = util.promisify(dns.resolve4);
                                               return dnsResolve4(config.NODE_HOST)
                                                   .then(addresses => {
                                                       if (addresses.includes(ip)) {
                                                           return config.NODE_HOST;
                                                       }
                                                       else {
                                                           return ip;
                                                       }
                                                   })
                                                   .catch(() => ip);
                                           });
                        }
                    })
                    .then(ip => {
                        console.log('[network] node public-ip', ip);
                        this.nodePublicIp = ip;
                        walletUtils.loadNodeKeyAndCertificate()
                                   .then(({
                                              certificate_private_key_pem: certificatePrivateKeyPem,
                                              certificate_pem            : certificatePem,
                                              node_private_key           : privateKey,
                                              node_public_key            : publicKey
                                          }) => {
                                       this.nodePrivateKey = privateKey;
                                       this.nodePublicKey  = base58.encode(publicKey.toBuffer());
                                       this.nodeID         = walletUtils.getNodeIdFromPublicKey(this.nodePublicKey);
                                       const nodeIDHash160 = objectHash.getSHA1Buffer(this.nodeID);
                                       this._initializeServer(certificatePem, certificatePrivateKeyPem);
                                       const bootstrap = _.map(config.NODE_INITIAL_LIST, ({
                                                                                              host,
                                                                                              port_discovery: port
                                                                                          }) => `${host}:${port}`);
                                       this.dht        = new DHT({
                                           nodeId: nodeIDHash160,
                                           verify: (sign, value, publicKeyRaw) => {
                                               publicKey = new Uint8Array(33);
                                               publicKey.set(publicKeyRaw, 1);

                                               // check compressed public key
                                               // for even y and odd y
                                               publicKey[0] = 2;
                                               let isValid  = signature.verifyBuffer(objectHash.getHashBuffer(value, true), sign, publicKey);
                                               if (!isValid) {
                                                   publicKey[0] = 3;
                                                   isValid      = signature.verifyBuffer(objectHash.getHashBuffer(value, true), sign, publicKey);
                                               }
                                               return isValid;
                                           },
                                           bootstrap
                                       });
                                       this.dht.on('node', node => {
                                           console.log(`[network] new node discovered ${node.host}:${node.port}`);
                                       });

                                       this.dht.listen(config.NODE_PORT_DISCOVERY);
                                       this.dht.on('listening', () => {
                                           const address = this.dht.address();
                                           console.log(`[network] dht listening @${address.address}:${address.port}`);
                                       });
                                       this.dht.on('ready', () => {
                                           console.log('[network] dht ready');
                                           // register default address in the
                                           // dht
                                           const walletID                    = wallet.getDefaultActiveWallet();
                                           const defaultKeyIdentifierAddress = wallet.deriveAddress(walletID, 0, 0);
                                           const addressVersion              = database.getRepository('address').getDefaultAddressVersion().version;
                                           const extendedPrivateKey          = wallet.getActiveWalletKey(walletID);
                                           const privateKey                  = walletUtils.derivePrivateKey(extendedPrivateKey, 0, 0);
                                           this.addAddressToDHT({
                                               address_base          : defaultKeyIdentifierAddress.address,
                                               address_version       : addressVersion,
                                               address_key_identifier: defaultKeyIdentifierAddress.address
                                           }, base58.decode(defaultKeyIdentifierAddress.address_attribute.key_public).slice(1, 33), privateKey);
                                       });
                                       eventBus.emit('network_ready');
                                       resolve();
                                   });
                    })
                    .catch(() => {
                        setTimeout(() => this.initialize().then(() => resolve()), 1000);
                    });
        });
    }

    _shouldUpdateProxyData(data, nodePublicIp, nodePort, nodeTransactionFee, nodeAddressDefault) {
        return !data || data.node_host !== nodePublicIp
               || data.node_port !== nodePort || data.node_proxy_fee !== nodeTransactionFee
               || data.node_address_default !== nodeAddressDefault;
    }

    addAddressToDHT(address, publicKey, privateKey) {
        const hash = objectHash.getSHA1Buffer(publicKey, true);
        this.dht.get(hash, (err, result) => {
            let previousProxyData;
            let newSeqNumber;
            if (result) {
                previousProxyData = JSON.parse(result.v.toString());
                newSeqNumber      = result.seq + 1;
            }
            else {
                previousProxyData = {};
                newSeqNumber      = 0;
            }

            let newProxyData;
            const nodeAddressDefault = address.address_key_identifier + address.address_version + address.address_key_identifier;
            if (this._shouldUpdateProxyData(previousProxyData, this.nodePublicIp, config.NODE_PORT, config.TRANSACTION_FEE_PROXY, nodeAddressDefault)) {
                newProxyData = {
                    node_id             : this.nodeID,
                    node_host           : this.nodePublicIp,
                    node_prefix         : config.WEBSOCKET_PROTOCOL,
                    node_port           : config.NODE_PORT,
                    node_port_api       : config.NODE_PORT_API,
                    node_proxy_fee      : config.TRANSACTION_FEE_PROXY,
                    node_address_default: nodeAddressDefault
                };
            }
            else {
                return;
            }

            const data = {
                k   : publicKey,
                seq : newSeqNumber,
                v   : JSON.stringify(newProxyData),
                sign: function(buf) {
                    return signature.sign(objectHash.getHashBuffer(buf, true), privateKey, 'buffer');
                }
            };

            console.log(`[network] dht v=${data.v}, len=${data.v.length}`);
            this.dht.put(data, (err, hash) => {
                console.log('[network] dht key identifier registered hash=', hash.toString('hex'), ', err=', err);
            });
        });
    }

    getProxyInfo(publicKey, proxyID) {
        return new Promise((resolve, reject) => {
            const hash = objectHash.getSHA1Buffer(publicKey, true);
            this.dht.get(hash, (err, result) => {
                if (err || !result) {
                    return reject('proxy_not_found');
                }
                let data;
                try {
                    data = JSON.parse(result.v.toString());
                }
                catch (e) {
                    return reject('bad_proxy_info');
                }
                const proxyData = data[proxyID];
                if (proxyData) {
                    proxyData['node_id'] = proxyID;
                    return resolve(proxyData);
                }

                reject('proxy_not_found');
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
            wss._server && wss._server.close();
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
        if (this.dht) {
            this.dht.destroy();
            this.dht = null;
        }
    }
}


export default new Network();
