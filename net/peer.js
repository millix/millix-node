import network from './network';
import eventBus from '../core/event-bus';
import config from '../core/config/config';
import crypto from 'crypto';
import _ from 'lodash';
import database from '../database/database';
import async from 'async';
import walletSync from '../core/wallet/wallet-sync';
import peerRotation from './peer-rotation';


class Peer {

    constructor() {
        this.noop                              = () => {
        };
        this.pendingTransactionSync            = {};
        this.pendingTransactionSpendSync       = {};
        this.pendingTransactionIncludePathSync = {};
    }

    sendNodeAddress(ipAddress, messageID, ws) {
        if (!ws) {
            return;
        }

        let payload = {
            type   : 'node_address_response:' + messageID,
            content: {ip_address: ipAddress}
        };
        eventBus.emit('node_event_log', payload);
        let data = JSON.stringify(payload);
        ws.nodeConnectionReady && ws.send(data);
    }

    getNodeAddress() {
        return new Promise((resolve, reject) => {
            let id      = crypto.randomBytes(20).toString('hex');
            let payload = {
                type   : 'node_address_request',
                content: {request_id: id}
            };

            eventBus.emit('node_event_log', payload);
            eventBus.once('node_address_response:' + id, (data) => {
                resolve(data);
            });

            setTimeout(() => {
                if (eventBus.listenerCount('node_address_response:' + id) > 0) {
                    reject('get_address_timeout');
                    eventBus.removeAllListeners('node_address_response:' + id);
                }
            }, config.NETWORK_LONG_TIME_WAIT_MAX);

            let data = JSON.stringify(payload);
            network.registeredClients.forEach(ws => {
                try {
                    ws.nodeConnectionReady && ws.send(data);
                }
                catch (e) {
                    console.log('[WARN]: try to send data over a closed connection.');
                }
            });
        });
    }

    sendNodeList(ws) {
        return database.getRepository('node')
                       .listNodes()
                       .then(nodes => {
                           nodes = _.map(nodes, node => _.pick(node, [
                               'node_prefix',
                               'node_ip_address',
                               'node_port',
                               'node_id'
                           ]));

                           nodes.push({
                               node_prefix    : config.WEBSOCKET_PROTOCOL,
                               node_ip_address: network.nodePublicIp,
                               node_port      : config.NODE_PORT,
                               node_id        : network.nodeID
                           }); // add self

                           if (nodes.length === 0) {
                               return;
                           }

                           let payload = {
                               type   : 'node_list',
                               content: nodes
                           };

                           eventBus.emit('node_event_log', payload);

                           let data = JSON.stringify(payload);
                           if (ws) { // send to a single node
                               try {
                                   ws.nodeConnectionReady && ws.send(data);
                               }
                               catch (e) {
                                   console.log('[WARN]: try to send data over a closed connection.');
                               }
                           }
                           else {
                               network.registeredClients.forEach(ws => {
                                   try {
                                       ws.nodeConnectionReady && ws.send(data);
                                   }
                                   catch (e) {
                                       console.log('[WARN]: try to send data over a closed connection.');
                                   }
                               });
                           }
                       });
    }

    transactionSend(transaction, excludeWS) {
        let payload = {
            type   : 'transaction_new',
            content: {transaction}
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        network.registeredClients.forEach(ws => {
            try {
                if (excludeWS !== ws) {
                    ws.nodeConnectionReady && ws.send(data);
                }
            }
            catch (e) {
                console.log('[WARN]: try to send data over a closed connection.');
            }
        });

        return transaction;
    }

    transactionSendToNode(transaction, ws) {
        let payload = {
            type   : 'transaction_new',
            content: transaction
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
        }

        return transaction;
    }

    auditPointValidationResponse(transactions, auditPointID, ws) {
        let payload = {
            type   : 'audit_point_validation_response:' + auditPointID,
            content: {transaction_id_list: transactions}
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
        }

        return transactions;
    }

    transactionIncludePathRequest(transactionID, excludeTransactions) {
        if (this.pendingTransactionIncludePathSync[transactionID]) {
            return Promise.reject();
        }

        this.pendingTransactionIncludePathSync[transactionID] = true;

        return new Promise((resolve, reject) => {

            let payload = {
                type   : 'transaction_include_path_request',
                content: {
                    transaction_id             : transactionID,
                    transaction_id_exclude_list: excludeTransactions
                }
            };

            let data = JSON.stringify(payload);

            eventBus.emit('node_event_log', payload);

            let nodesWS = _.shuffle(network.registeredClients);

            async.eachSeries(nodesWS, (ws, callback) => {
                let callbackCalled = false;
                let nodeID         = ws.nodeID;
                try {
                    if (ws.nodeConnectionReady) {

                        eventBus.removeAllListeners('transaction_include_path_response:' + transactionID);
                        eventBus.once('transaction_include_path_response:' + transactionID, function(eventData, eventWS) {
                            console.log('[peer] stopping transaction spend sync for transaction id ', transactionID, 'because data was received from node ', nodeID);

                            if (!callbackCalled) {
                                resolve([
                                    eventData,
                                    eventWS
                                ]);
                                callbackCalled = true;
                                callback(true);
                            }

                        });

                        ws.send(data);

                        setTimeout(function() {
                            if (!callbackCalled) {
                                callbackCalled = true;
                                callback();
                            }
                        }, config.NETWORK_SHORT_TIME_WAIT_MAX);

                    }
                    else {
                        callback();
                    }

                }
                catch (e) {
                    console.log('[WARN]: try to send data over a closed connection.');
                    if (!callbackCalled) {
                        callbackCalled = true;
                        callback();
                    }
                }
            }, (done) => {
                eventBus.removeAllListeners('transaction_include_path_response:' + transactionID);
                delete this.pendingTransactionIncludePathSync[transactionID];

                if (!done) {
                    console.log('[peer] transaction_include_path_response:' + transactionID + ' not received. skip...');
                    reject();
                }
            });

        });
    }

    transactionSpendResponse(transactionID, transactions, ws) {
        let payload = {
            type   : 'transaction_spend_response:' + transactionID,
            content: {transaction_id_list: transactions}
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
        }

    }

    transactionSpendRequest(transactionID) {
        if (this.pendingTransactionSpendSync[transactionID]) {
            return Promise.reject();
        }

        this.pendingTransactionSpendSync[transactionID] = true;

        return new Promise((resolve, reject) => {

            let payload = {
                type   : 'transaction_spend_request',
                content: {transaction_id: transactionID}
            };

            let data = JSON.stringify(payload);

            eventBus.emit('node_event_log', payload);

            let nodesWS = _.shuffle(network.registeredClients);

            async.eachSeries(nodesWS, (ws, callback) => {
                let callbackCalled = false;
                let nodeID         = ws.nodeID;
                try {
                    if (ws.nodeConnectionReady) {

                        eventBus.removeAllListeners('transaction_spend_response:' + transactionID);
                        eventBus.once('transaction_spend_response:' + transactionID, function(eventData) {
                            console.log('[peer] stopping transaction spend sync for transaction id ', transactionID, 'because data was received from node ', nodeID);

                            if (!callbackCalled) {
                                resolve(eventData);
                                callbackCalled = true;
                                callback(true);
                            }

                        });

                        ws.send(data);

                        setTimeout(function() {
                            if (!callbackCalled) {
                                callbackCalled = true;
                                callback();
                            }
                        }, config.NETWORK_SHORT_TIME_WAIT_MAX);

                    }
                    else {
                        callback();
                    }

                }
                catch (e) {
                    console.log('[WARN]: try to send data over a closed connection.');
                    if (!callbackCalled) {
                        callbackCalled = true;
                        callback();
                    }
                }
            }, (done) => {
                eventBus.removeAllListeners('transaction_spend_response:' + transactionID);
                delete this.pendingTransactionSpendSync[transactionID];

                if (!done) {
                    console.log('[peer] transaction_spend_response:' + transactionID + ' not received. skip...');
                    reject();
                }
            });

        });
    }

    transactionIncludePathResponse(message, ws) {
        let payload = {
            type   : 'transaction_include_path_response:' + message.transaction_id,
            content: message
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
        }

        return message;
    }

    transactionValidationRequest(content, ws) {
        return new Promise((resolve, reject) => {
            let payload = {
                type: 'transaction_validation_request',
                content
            };

            eventBus.emit('node_event_log', payload);
            console.log('[peer] validation request from node ', ws.node);

            let data = JSON.stringify(payload);
            try {
                let callbackCalled = false;
                if (ws.nodeConnectionReady) {
                    const messageID = 'transaction_validation_response:' + content.transaction_id + ':' + content.consensus_round + ':' + ws.nodeID;
                    eventBus.removeAllListeners(messageID);
                    eventBus.once(messageID, function(eventData, eventWS) {

                        console.log('[peer] received validation response for ', eventData.transaction_id, ' from node ', eventWS.node);

                        if (eventWS.nodeID !== ws.nodeID || eventWS.connectionID !== ws.connectionID) {
                            return;
                        }

                        console.log('[peer] received validation response for ', eventData.transaction_id, ' from node ', eventWS.node);
                        if (!callbackCalled) {
                            console.log('[peer] received validation response for ', eventData.transaction_id, ' from node ', eventWS.node, 'success');
                            callbackCalled = true;
                            resolve([
                                eventData,
                                eventWS
                            ]);
                        }
                    });
                    ws.send(data);
                    setTimeout(function() {
                        if (!callbackCalled) {
                            console.log('[peer] validation response from node ', ws.node, 'timeout');
                            callbackCalled = true;
                            reject();
                        }
                    }, config.CONSENSUS_VALIDATION_WAIT_TIME_MAX);
                }
                else {
                    reject();
                }
            }
            catch (e) {
                console.log('[WARN]: try to send data over a closed connection.');
                reject();
            }

        });
    }

    allocateNodeToValidateTransaction(content, ws) {
        return new Promise((resolve, reject) => {
            const payload = {
                type: 'transaction_validation_node_allocate',
                content
            };

            eventBus.emit('node_event_log', payload);

            let data = JSON.stringify(payload);
            try {
                let callbackCalled = false;
                if (ws.nodeConnectionReady) {
                    const messageID = 'transaction_validation_node_allocate_response:' + ws.nodeID;
                    eventBus.removeAllListeners(messageID);
                    eventBus.once(messageID, function(eventData, eventWS) {
                        if (eventWS.nodeID !== ws.nodeID || eventWS.connectionID !== ws.connectionID) {
                            return;
                        }

                        console.log('[peer] received allocation response for ', eventData.transaction_id, ' from node ', eventWS.node);
                        if (!callbackCalled) {
                            callbackCalled = true;
                            resolve([
                                eventData,
                                eventWS
                            ]);
                        }
                    });
                    ws.send(data);
                    setTimeout(function() {
                        if (!callbackCalled) {
                            callbackCalled = true;
                            reject();
                        }
                    }, config.NETWORK_SHORT_TIME_WAIT_MAX);
                }
                else {
                    reject();
                }
            }
            catch (e) {
                console.log('[WARN]: try to send data over a closed connection.');
                reject();
            }
        });

    }

    replyNodeAllocationRequest(content, ws) {
        return new Promise((resolve, reject) => {
            let payload = {
                type: 'transaction_validation_node_allocate_response:' + network.nodeID,
                content
            };

            eventBus.emit('node_event_log', payload);

            let data = JSON.stringify(payload);
            try {
                let callbackCalled = false;
                if (ws.nodeConnectionReady) {
                    const messageID = 'transaction_validation_node_allocate_acknowledge:' + ws.nodeID;
                    eventBus.removeAllListeners(messageID);
                    eventBus.once(messageID, function(eventData, eventWS) {
                        if (eventWS.nodeID !== ws.nodeID || eventWS.connectionID !== ws.connectionID) {
                            return;
                        }

                        console.log('[peer] received allocation acknowledge for consensus round of ', eventData.transaction_id, ' from node ', eventWS.nodeID);
                        if (!callbackCalled) {
                            callbackCalled = true;
                            resolve();
                        }
                    });
                    ws.send(data);
                    setTimeout(function() {
                        if (!callbackCalled) {
                            callbackCalled = true;
                            reject();
                        }
                    }, config.NETWORK_SHORT_TIME_WAIT_MAX);
                }
                else {
                    reject();
                }
            }
            catch (e) {
                console.log('[WARN]: try to send data over a closed connection.');
                reject();
            }
        });
    }

    acknowledgeAllocateNodeToValidateTransaction(content, ws) {
        let payload = {
            type: 'transaction_validation_node_allocate_acknowledge:' + network.nodeID,
            content
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
        }
    }

    releaseNodeToValidateTransaction(content, ws) {
        let payload = {
            type: 'transaction_validation_node_release',
            content
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
        }
    }

    auditPointValidationRequest(content, ws) {
        let payload = {
            type: 'audit_point_validation_request',
            content
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
        }

        return content;
    }

    transactionValidationResponse(message, ws) {
        let payload = {
            type   : 'transaction_validation_response:' + message.transaction_id + ':' + message.consensus_round + ':' + network.nodeID,
            content: message
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
        }

        return message;
    }

    shardSyncResponse(content, ws) {
        let payload = {
            type: 'shard_sync_response:' + content.shard_id,
            content
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
        }

    }

    shardSync(shardID, ws) {
        return new Promise((resolve, reject) => {
            let payload = {
                type   : 'shard_sync_request',
                content: {shard_id: shardID}
            };

            eventBus.emit('node_event_log', payload);

            let data = JSON.stringify(payload);
            try {
                if (ws.nodeConnectionReady) {
                    let timeoutID;
                    let listener = function(data) {
                        resolve(data);
                        clearTimeout(timeoutID);
                    };

                    eventBus.once('shard_sync_response:' + shardID, listener);

                    ws.send(data);
                    ws        = null;
                    timeoutID = setTimeout(() => {
                        eventBus.removeListener('shard_sync_response:' + shardID, listener);
                        reject('shard_sync_response_timeout');
                    }, config.NETWORK_SHORT_TIME_WAIT_MAX);
                }
            }
            catch (e) {
                reject('[WARN]: try to send data over a closed connection.');
            }
        });
    }

    addressTransactionSync(address, updated, ws) {

        if (network.registeredClients.length === 0) {
            return address;
        }

        console.log('[peer] requesting transaction sync for address:', address, ' from ', updated);
        let payload = {
            type   : 'address_transaction_sync',
            content: {
                address,
                updated
            }
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        if (ws) {
            try {
                ws.nodeConnectionReady && ws.send(data);
            }
            catch (e) {
                console.log('[WARN]: try to send data over a closed connection.');
            }
        }
        else {
            network.registeredClients.forEach(ws => {
                try {
                    ws.nodeConnectionReady && ws.send(data);
                }
                catch (e) {
                    console.log('[WARN]: try to send data over a closed connection.');
                }
            });
        }

        return address;
    }

    transactionSyncResponse(content, ws) {
        let payload = {
            type: 'transaction_sync_response:' + content.transaction.transaction_id,
            content
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
        }

        return content;
    }

    transactionSyncRequest(transactionID, options = {}) {
        const {depth: currentDepth, request_node_id: requestNodeID, routing, priority, dispatch_request: dispatchRequest} = options;
        return new Promise((resolve, reject) => {

            walletSync.add(transactionID, {
                delay: !dispatchRequest ? 0 : config.NETWORK_LONG_TIME_WAIT_MAX * 10,
                priority
            });

            if (network.registeredClients.length === 0 || this.pendingTransactionSync[transactionID]) {
                return reject();
            }
            else if (!dispatchRequest) {
                return resolve();
            }

            console.log('[peer] requesting transaction sync for :', transactionID);
            let payload = {
                type   : 'transaction_sync',
                content: {
                    transaction_id         : transactionID,
                    depth                  : currentDepth || 0,
                    routing                : routing,
                    routing_request_node_id: requestNodeID
                }
            };

            eventBus.emit('node_event_log', payload);

            let data = JSON.stringify(payload);

            this.pendingTransactionSync[transactionID] = true;


            let nodesWS = _.shuffle(network.registeredClients);

            async.eachSeries(nodesWS, (ws, callback) => {
                let callbackCalled = false;
                let nodeID         = ws.nodeID;
                try {
                    if (ws.nodeConnectionReady) {
                        eventBus.removeAllListeners('transaction_sync_response:' + transactionID);
                        eventBus.once('transaction_sync_response:' + transactionID, function(eventData, eventWS) {
                            console.log('[peer] stopping transaction sync for transaction id ', transactionID, 'because data was received from node ', nodeID);
                            eventBus.emit('transaction_new', eventData, eventWS, true);
                            if (!callbackCalled) {
                                callbackCalled = true;
                                callback(true);
                            }
                        });
                        ws.send(data);
                        setTimeout(function() {
                            if (!callbackCalled) {
                                callbackCalled = true;
                                callback();
                            }
                        }, config.NETWORK_SHORT_TIME_WAIT_MAX);
                    }
                    else {
                        callback();
                    }
                }
                catch (e) {
                    console.log('[WARN]: try to send data over a closed connection.');
                    if (!callbackCalled) {
                        callbackCalled = true;
                        callback();
                    }
                }
            }, (done) => {
                eventBus.removeAllListeners('transaction_sync_response:' + transactionID);
                delete this.pendingTransactionSync[transactionID];

                if (!done) {
                    console.log('[peer] transaction_sync_response:' + transactionID + ' not received. skip...');
                    walletSync.add(transactionID, {priority});
                }
                resolve();
            });
        });
    }

    transactionSyncByWebSocket(transactionID, ws, currentDepth) {
        return new Promise((resolve) => {

            if (this.pendingTransactionSync[transactionID]) {
                return resolve();
            }

            console.log('[peer] requesting transaction sync for :', transactionID);
            let payload = {
                type   : 'transaction_sync',
                content: {
                    transaction_id: transactionID,
                    depth         : currentDepth || 0
                }
            };

            eventBus.emit('node_event_log', payload);

            let data = JSON.stringify(payload);

            try {
                if (ws.nodeConnectionReady) {
                    eventBus.removeAllListeners('transaction_sync_response:' + transactionID);

                    eventBus.once('transaction_sync_response:' + transactionID, function(data, eventWS) {
                        eventBus.emit('transaction_new', data, eventWS, true);
                    });

                    ws.send(data);
                    ws = null;
                    setTimeout(() => {
                        if (!this.pendingTransactionSync[transactionID]) {
                            eventBus.removeAllListeners('transaction_sync_response:' + transactionID);
                        }
                    }, config.NETWORK_SHORT_TIME_WAIT_MAX);
                }
            }
            catch (e) {
                console.log('[WARN]: try to send data over a closed connection.');
            }

            resolve();
        });
    }

    _onNodeList(nodes, ws) {
        eventBus.emit('node_event_log', {
            type   : 'node_list',
            content: nodes,
            from   : ws.node
        });
        const nodeRepository = database.getRepository('node');
        async.eachSeries(nodes, (data, callback) => {
            data.node_port_api = data.node_port_api || config.NODE_PORT_API;
            if (network.addNode(data.node_prefix, data.node_ip_address, data.node_port, data.node_port_api, data.node_id)) {
                nodeRepository.addNode(data)
                              .then(() => callback())
                              .catch(() => callback());
            }
            else {
                callback();
            }
        }, () => {
            nodeRepository.addNodeAttribute(ws.nodeID, 'peer_count', nodes.length)
                          .then(_ => _)
                          .catch(_ => _);
        });
    }

    sendConnectionReady(ws) {
        ws.nodeConnectionState = !ws.nodeConnectionState ? 'waiting' : 'open';
        if (ws.nodeConnectionState === 'open') {
            ws.nodeConnectionReady = true;
        }
        let payload = {
            type: 'connection_ready'
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
        }
    }

    nodeAttributeRequest(content, ws) {
        let payload = {
            type: 'node_attribute_request',
            content
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
        }
    }

    nodeAttributeResponse(content, ws) {
        let payload = {
            type: 'node_attribute_response',
            content
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
        }
    }

    _onNodeAttributeRequest(content, ws) {
        eventBus.emit('node_event_log', {
            type: 'node_attribute_request',
            from: ws.node,
            content
        });
        database.getRepository('node')
                .getNodeAttribute(content.node_id, content.attribute_type)
                .then(attributeValue => {
                    this.nodeAttributeResponse({
                        node_id       : content.node_id,
                        attribute_type: content.attribute_type,
                        value         : attributeValue
                    }, ws);
                })
                .catch(_ => _);
    }

    _onNodeAttributeResponse(content, ws) {
        eventBus.emit('node_event_log', {
            type: 'node_attribute_response',
            from: ws.node,
            content
        });
        if (content.node_id && content.attribute_type && content.value !== undefined) {
            const nodeRepository = database.getRepository('node');
            nodeRepository.addNodeAttribute(content.node_id, content.attribute_type, content.value)
                          .then(_ => _)
                          .catch(_ => _);
        }
    }

    _doPeerRotation() {
        return peerRotation.doPeerRotation();
    }

    initialize() {
        eventBus.on('node_list', this._onNodeList.bind(this));
        eventBus.on('node_attribute_request', this._onNodeAttributeRequest.bind(this));
        eventBus.on('node_attribute_response', this._onNodeAttributeResponse.bind(this));
    }

    stop() {
        eventBus.removeAllListeners('node_list');
    }
}


export default new Peer();
