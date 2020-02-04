import network from './network';
import task from '../core/task';
import event_bus from '../core/event-bus';
import config from '../core/config/config';
import crypto from 'crypto';
import _ from 'lodash';
import database from '../database/database';
import async from 'async';
import walletSync from '../core/wallet/wallet-sync';


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
        event_bus.emit('node_event_log', payload);
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

            event_bus.emit('node_event_log', payload);
            event_bus.once('node_address_response:' + id, (data) => {
                resolve(data);
            });

            setTimeout(() => {
                if (event_bus.listenerCount('node_address_response:' + id) > 0) {
                    reject('get address timeout');
                    event_bus.removeAllListeners('node_address_response:' + id);
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

    sendNodeList() {
        return database.getRepository('node')
                       .getNodes()
                       .then(nodes => {
                           nodes = _.map(nodes, node => _.pick(node, [
                               'node_prefix',
                               'node_ip_address',
                               'node_port',
                               'node_id'
                           ]));

                           if (config.NODE_PUBLIC) {
                               nodes.push({
                                   node_prefix    : config.WEBSOCKET_PROTOCOL,
                                   node_ip_address: config.NODE_HOST,
                                   node_port      : config.NODE_PORT,
                                   node_id        : network.nodeID
                               }); // add self
                           }

                           if (nodes.length === 0) {
                               return;
                           }

                           let payload = {
                               type   : 'node_list',
                               content: nodes
                           };

                           event_bus.emit('node_event_log', payload);

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

    transactionSend(transaction, excludeWS) {
        let payload = {
            type   : 'transaction_new',
            content: {transaction}
        };

        event_bus.emit('node_event_log', payload);

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

        event_bus.emit('node_event_log', payload);

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

        event_bus.emit('node_event_log', payload);

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

            event_bus.emit('node_event_log', payload);

            let nodesWS = _.shuffle(network.registeredClients);

            async.eachSeries(nodesWS, (ws, callback) => {
                let callbackCalled = false;
                let nodeID         = ws.nodeID;
                try {
                    if (ws.nodeConnectionReady) {

                        event_bus.removeAllListeners('transaction_include_path_response:' + transactionID);
                        event_bus.once('transaction_include_path_response:' + transactionID, function(eventData, eventWS) {
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
                event_bus.removeAllListeners('transaction_include_path_response:' + transactionID);
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

        event_bus.emit('node_event_log', payload);

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

            event_bus.emit('node_event_log', payload);

            let nodesWS = _.shuffle(network.registeredClients);

            async.eachSeries(nodesWS, (ws, callback) => {
                let callbackCalled = false;
                let nodeID         = ws.nodeID;
                try {
                    if (ws.nodeConnectionReady) {

                        event_bus.removeAllListeners('transaction_spend_response:' + transactionID);
                        event_bus.once('transaction_spend_response:' + transactionID, function(eventData) {
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
                event_bus.removeAllListeners('transaction_spend_response:' + transactionID);
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

        event_bus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
        }

        return message;
    }

    transactionValidationRequest(transaction, ws) {
        let payload = {
            type   : 'transaction_validation_request',
            content: transaction
        };

        event_bus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
        }

        return transaction;
    }

    auditPointValidationRequest(content, ws) {
        let payload = {
            type: 'audit_point_validation_request',
            content
        };

        event_bus.emit('node_event_log', payload);

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
            type   : 'transaction_validation_response:' + message.transaction_id + ':' + message.consensus_round,
            content: message
        };

        event_bus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
        }

        return message;
    }

    addressTransactionSync(address, updated) {

        if (network.registeredClients.length === 0) {
            return address;
        }

        console.log('Requesting transaction sync for address:', address, ' from ', updated);
        let payload = {
            type   : 'address_transaction_sync',
            content: {
                address,
                updated
            }
        };

        event_bus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        network.registeredClients.forEach(ws => {
            try {
                ws.nodeConnectionReady && ws.send(data);
            }
            catch (e) {
                console.log('[WARN]: try to send data over a closed connection.');
            }
        });

        return address;
    }

    transactionSyncResponse(content, ws) {
        let payload = {
            type: 'transaction_sync_response:' + content.transaction.transaction_id,
            content
        };

        event_bus.emit('node_event_log', payload);

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
        const {depth: currentDepth, request_node_id: requestNodeID, routing, priority} = options;
        return new Promise((resolve, reject) => {

            walletSync.add(transactionID, {
                delay: config.NETWORK_LONG_TIME_WAIT_MAX * 10,
                priority
            });

            if (network.registeredClients.length === 0 || this.pendingTransactionSync[transactionID]) {
                return reject();
            }

            console.log('Requesting transaction sync for :', transactionID);
            let payload = {
                type   : 'transaction_sync',
                content: {
                    transaction_id         : transactionID,
                    depth                  : currentDepth || 0,
                    routing                : routing,
                    routing_request_node_id: requestNodeID
                }
            };

            event_bus.emit('node_event_log', payload);

            let data = JSON.stringify(payload);

            this.pendingTransactionSync[transactionID] = true;


            let nodesWS = _.shuffle(network.registeredClients);

            async.eachSeries(nodesWS, (ws, callback) => {
                let callbackCalled = false;
                let nodeID         = ws.nodeID;
                try {
                    if (ws.nodeConnectionReady) {
                        event_bus.removeAllListeners('transaction_sync_response:' + transactionID);
                        event_bus.once('transaction_sync_response:' + transactionID, function(eventData, eventWS) {
                            console.log('[peer] stopping transaction sync for transaction id ', transactionID, 'because data was received from node ', nodeID);
                            event_bus.emit('transaction_new', eventData, eventWS, true);
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
                event_bus.removeAllListeners('transaction_sync_response:' + transactionID);
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

            console.log('Requesting transaction sync for :', transactionID);
            let payload = {
                type   : 'transaction_sync',
                content: {
                    transaction_id: transactionID,
                    depth         : currentDepth || 0
                }
            };

            event_bus.emit('node_event_log', payload);

            let data = JSON.stringify(payload);

            try {
                if (ws.nodeConnectionReady) {
                    event_bus.removeAllListeners('transaction_sync_response:' + transactionID);

                    event_bus.once('transaction_sync_response:' + transactionID, function(data, eventWS) {
                        event_bus.emit('transaction_new', data, eventWS, true);
                    });

                    ws.send(data);
                    ws = null;
                    setTimeout(() => {
                        if (!this.pendingTransactionSync[transactionID]) {
                            event_bus.removeAllListeners('transaction_sync_response:' + transactionID);
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
        event_bus.emit('node_event_log', {
            type   : 'node_list',
            content: nodes,
            from   : ws.node
        });
        nodes.forEach(data => network.addNode(data.node_prefix, data.node_ip_address, data.node_port, data.node_id));
    }

    initialize() {
        event_bus.on('node_list', this._onNodeList.bind(this));
    }

    stopTasks() {
        event_bus.removeAllListeners('node_list');
    }
}


export default new Peer();
