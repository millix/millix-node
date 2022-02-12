import network from './network';
import eventBus from '../core/event-bus';
import config from '../core/config/config';
import crypto from 'crypto';
import _ from 'lodash';
import database from '../database/database';
import async from 'async';
import walletSync from '../core/wallet/wallet-sync';
import peerRotation from './peer-rotation';
import statistics from '../core/statistics';
import wallet from '../core/wallet/wallet';


class Peer {

    constructor() {
        this.noop                              = () => {
        };
        this.pendingTransactionSync            = {};
        this.pendingTransactionSpendSync       = {};
        this.pendingTransactionOutputSpendSync = {};
        this.pendingTransactionIncludePathSync = {};
        this.nodeAttributeCache                = {};
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
                    ws && ws.close();
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
                               'node_address',
                               'node_port_api',
                               'node_port',
                               'node_id'
                           ]));

                           nodes.push({
                               node_prefix  : config.WEBSOCKET_PROTOCOL,
                               node_address : network.nodePublicIp,
                               node_port_api: config.NODE_PORT_API,
                               node_port    : config.NODE_PORT,
                               node_id      : network.nodeID
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
                                   ws && ws.close();
                               }
                           }
                           else {
                               network.registeredClients.forEach(ws => {
                                   try {
                                       ws.nodeConnectionReady && ws.send(data);
                                   }
                                   catch (e) {
                                       console.log('[WARN]: try to send data over a closed connection.');
                                       ws && ws.close();
                                   }
                               });
                           }
                       });
    }

    propagateTransactionList(transactions) {
        const payload = {
            type   : 'transaction_list_propagate',
            content: {transaction_id_list: transactions}
        };

        eventBus.emit('node_event_log', payload);

        const data = JSON.stringify(payload);
        network.registeredClients.forEach(ws => {
            try {
                ws.nodeConnectionReady && ws.send(data);
            }
            catch (e) {
                console.log('[WARN]: try to send data over a closed connection.');
                ws && ws.close();
            }
        });
    }

    transactionSend(transaction, excludeWS) {
        if(!transaction) {
            return;
        }

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
                ws && ws.close();
            }
        });

        return transaction;
    }

    transactionSendToNode(transaction, ws) {
        if(!transaction) {
            return;
        }

        let payload = {
            type   : 'transaction_new',
            content: {transaction}
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
            ws && ws.close();
        }

        return transaction;
    }

    transactionProxyResponse(response, ws) {
        let payload = {
            type   : `transaction_new_response_proxy:${network.nodeID}:${response.transaction_id}`,
            content: {...response}
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
            ws && ws.close();
        }
    }

    transactionProxyResult(result, ws) {
        let payload = {
            type   : `transaction_new_proxy:${network.nodeID}:${result.transaction_id}`,
            content: {...result}
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
            ws && ws.close();
        }
    }

    transactionProxy(transactionList, proxyTimeLimit, ws) {
        return new Promise((resolve, reject) => {
            let payload = {
                type   : 'transaction_new_proxy',
                content: {
                    transaction_list: transactionList,
                    proxy_time_limit: proxyTimeLimit
                }
            };

            const transaction = transactionList[0];

            eventBus.emit('node_event_log', payload);

            let data = JSON.stringify(payload);
            try {
                const nodeID        = ws.nodeID;
                const transactionID = transaction.transaction_id;
                eventBus.removeAllListeners(`transaction_new_proxy:${nodeID}:${transactionID}`);
                let timeLimitTriggered = false;
                let responseProcessed  = false;
                let timeoutHandler     = undefined;
                eventBus.once(`transaction_new_proxy:${nodeID}:${transactionID}`, (response) => {
                    responseProcessed = true;
                    if (!timeLimitTriggered) {
                        if (response.transaction_proxy_success) {
                            console.log('[peer] transaction ', transactionID, ' proxied by node ', nodeID);
                            resolve(transactionList);
                        }
                        else if (response.cause === 'proxy_time_limit_exceed') {
                            console.log('[peer] transaction proxy timeout on ', nodeID, 'for transaction', transactionID);
                            reject('proxy_time_limit_exceed');
                        }
                        else {
                            console.log('[peer] transaction proxy rejected by ', nodeID, 'for transaction', transactionID, 'cause:', response.cause);
                            reject('transaction_proxy_rejected');
                        }
                        clearTimeout(timeoutHandler);
                    }
                });

                timeoutHandler = setTimeout(() => {
                    timeLimitTriggered = true;
                    if (!responseProcessed) {
                        console.log('[peer] self-triggered transaction proxy timeout on for transaction', transactionID);
                        reject('proxy_time_limit_exceed');
                    }
                }, proxyTimeLimit + config.NETWORK_SHORT_TIME_WAIT_MAX);
                ws.nodeConnectionReady && ws.send(data);
            }
            catch (e) {
                console.log('[WARN]: try to send data over a closed connection.');
                ws && ws.close();
                reject('proxy_network_error');
            }
        });
    }

    transactionProxyRequest(transactionList, proxyData) {
        const transaction = transactionList[0];
        const feeOutput   = transactionList[transactionList.length - 1].transaction_output_list[0];
        return network._connectTo(proxyData.node_prefix, proxyData.node_host, proxyData.node_port, proxyData.node_port_api, proxyData.node_id)
                      .then(ws => {
                          return new Promise((resolve, reject) => {
                              let payload = {
                                  type   : 'transaction_new_request_proxy',
                                  content: {
                                      transaction_id        : transaction.transaction_id,
                                      transaction_date      : transaction.transaction_date,
                                      transaction_input_list: transaction.transaction_input_list,
                                      transaction_output_fee: feeOutput
                                  }
                              };

                              eventBus.emit('node_event_log', payload);

                              let data = JSON.stringify(payload);
                              try {
                                  if (ws.nodeConnectionReady && !(ws.inBound && !ws.bidirectional)) {
                                      const transactionID = transaction.transaction_id;
                                      const nodeID        = ws.nodeID;
                                      let callbackCalled  = false;
                                      eventBus.removeAllListeners(`transaction_new_response_proxy:${nodeID}:${transactionID}`);
                                      eventBus.once(`transaction_new_response_proxy:${nodeID}:${transactionID}`, (eventData, eventWS) => {
                                          if (!callbackCalled) {
                                              callbackCalled = true;
                                              console.log('[peer] received transaction proxy response for ', transactionID, ' from node ', nodeID);
                                              eventBus.emit('node_event_log', {
                                                  type   : 'transaction_new_response_proxy',
                                                  content: eventData,
                                                  from   : eventWS.node
                                              });
                                              resolve([
                                                  transactionList,
                                                  eventData,
                                                  eventWS
                                              ]);
                                          }
                                      });

                                      ws.send(data);

                                      setTimeout(function() {
                                          if (!callbackCalled) {
                                              callbackCalled = true;
                                              eventBus.removeAllListeners(`transaction_new_proxy:${nodeID}:${transactionID}`);
                                              reject('proxy_timeout');
                                          }
                                      }, config.NETWORK_LONG_TIME_WAIT_MAX * 15);

                                  }
                                  else {
                                      return reject('proxy_connection_state_invalid');
                                  }
                              }
                              catch (e) {
                                  console.log('[WARN]: try to send data over a closed connection.');
                                  ws && ws.close();
                                  return reject('proxy_network_error');
                              }
                          });
                      });
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
                    if (ws.nodeConnectionReady && !(ws.inBound && !ws.bidirectional)) {

                        eventBus.removeAllListeners('transaction_include_path_response:' + transactionID);
                        eventBus.once('transaction_include_path_response:' + transactionID, function(eventData, eventWS) {
                            console.log('[peer] received include path for transaction id ', transactionID, ' from node ', nodeID);

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
                    ws && ws.close();
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
        if (ws.outBound && !ws.bidirectional) {
            return;
        }

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
            ws && ws.close();
        }

    }

    transactionOutputSpendResponse(transactionID, outputPosition, transactions, ws) {
        if (ws.outBound && !ws.bidirectional) {
            return;
        }

        let payload = {
            type   : 'transaction_output_spend_response',
            content: {
                transaction_id  : transactionID,
                output_position : outputPosition,
                transaction_list: transactions
            }
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
            ws && ws.close();
        }

    }

    transactionOutputSpendRequest(transactionID, outputPosition) {
        const transactionOutputID = `${transactionID}_${outputPosition}`;
        if (this.pendingTransactionOutputSpendSync[transactionOutputID]) {
            return Promise.reject();
        }

        this.pendingTransactionOutputSpendSync[transactionOutputID] = true;

        return new Promise((resolve, reject) => {

            let payload = {
                type   : 'transaction_output_spend_request',
                content: {
                    transaction_id : transactionID,
                    output_position: outputPosition
                }
            };

            let data = JSON.stringify(payload);

            eventBus.emit('node_event_log', payload);

            let nodesWS = _.shuffle(network.registeredClients);

            async.eachSeries(nodesWS, (ws, callback) => {
                let callbackCalled = false;
                let nodeID         = ws.nodeID;
                try {
                    if (ws.nodeConnectionReady && !(ws.inBound && !ws.bidirectional)) {

                        eventBus.removeAllListeners(`transaction_output_spend_response:${transactionOutputID}`);
                        eventBus.once(`transaction_output_spend_response:${transactionOutputID}`, function(eventData) {
                            console.log(`[peer] received transaction output spend for transaction id ${transactionID} output position ${outputPosition} from node ${nodeID}`);

                            if (!callbackCalled) {
                                callbackCalled = true;
                                if (!eventData || !eventData.transaction_list || eventData.transaction_list.length === 0) {
                                    callback();
                                }
                                else {
                                    resolve(eventData);
                                    callback(true);
                                }
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
                    ws && ws.close();
                    if (!callbackCalled) {
                        callbackCalled = true;
                        callback();
                    }
                }
            }, (done) => {
                eventBus.removeAllListeners(`transaction_output_spend_response:${transactionOutputID}`);
                delete this.pendingTransactionOutputSpendSync[transactionOutputID];

                if (!done) {
                    console.log(`[peer] transaction_output_spend_response:${transactionOutputID} not received. skip...`);
                    reject();
                }
            });

        });
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
                    if (ws.nodeConnectionReady && !(ws.inBound && !ws.bidirectional)) {

                        eventBus.removeAllListeners('transaction_spend_response:' + transactionID);
                        eventBus.once('transaction_spend_response:' + transactionID, function(eventData) {
                            console.log('[peer] received transaction spend sync for transaction id ', transactionID, ' from node ', nodeID);

                            if (!callbackCalled) {
                                callbackCalled = true;
                                if (!eventData || !eventData.transaction_id_list || eventData.transaction_id_list.length === 0) {
                                    callback();
                                }
                                else {
                                    resolve(eventData);
                                    callback(true);
                                }
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
                    ws && ws.close();
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
        if (ws.outBound && !ws.bidirectional) {
            return message;
        }

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
            ws && ws.close();
        }

        return message;
    }

    transactionValidationRequest(content, ws) {
        return new Promise((resolve, reject) => {
            let payload = {
                type: 'transaction_validation_start',
                content
            };

            eventBus.emit('node_event_log', payload);
            console.log('[peer] validation request from node ', ws.node);

            let data = JSON.stringify(payload);
            try {
                let callbackCalled = false;
                if (ws.nodeConnectionReady) {
                    const messageID = 'transaction_validation_response:' + content.transaction_id;
                    eventBus.removeAllListeners(messageID);
                    eventBus.once(messageID, function(eventData, eventWS) {
                        if (eventWS.nodeID !== ws.nodeID || eventWS.connectionID !== ws.connectionID) {
                            return;
                        }
                        if (!callbackCalled) {
                            console.log('[peer] received validation response for ', eventData.transaction_id, ' from node ', eventWS.node);
                            callbackCalled = true;
                            resolve(eventData);
                        }
                    });
                    ws.send(data);
                    setTimeout(function() {
                        if (!callbackCalled) {
                            console.log('[peer] validation response from node ', ws.node, 'timeout');
                            callbackCalled = true;
                            reject('node_timeout');
                        }
                    }, config.NETWORK_LONG_TIME_WAIT_MAX * 15);
                }
                else {
                    reject('node_connection_not_ready');
                }
            }
            catch (e) {
                console.log('[WARN]: try to send data over a closed connection.');
                ws && ws.close();
                reject('node_connection_closed');
            }

        });
    }

    transactionValidationResponse(message, ws, isValidationResult) {
        let payload = {
            type   : isValidationResult ? 'transaction_validation_response' : 'transaction_validation_response:' + message.transaction_id,
            content: message
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
            ws && ws.close();
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
            ws && ws.close();
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
                console.log('[WARN]: try to send data over a closed connection.');
                ws && ws.close();
                reject();
            }
        });
    }

    walletTransactionSyncResponse(transactions, ws) {
        const payload = {
            type   : 'wallet_transaction_sync_response',
            content: {
                transaction_id_list: transactions
            }
        };

        eventBus.emit('node_event_log', payload);

        const data = JSON.stringify(payload);
        if (ws) {
            try {
                ws.nodeConnectionReady && ws.send(data);
            }
            catch (e) {
                console.log('[WARN]: try to send data over a closed connection.');
                ws && ws.close();
            }
        }
    }

    walletTransactionSync(addressKeyIdentifier, ws) {

        if (network.registeredClients.length === 0) {
            return;
        }

        console.log('[peer] requesting transaction sync for wallet: ', addressKeyIdentifier);
        let payload = {
            type   : 'wallet_transaction_sync',
            content: {
                address_key_identifier: addressKeyIdentifier
            }
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        if (ws) {
            try {
                ws.nodeConnectionReady && !(ws.inBound && !ws.bidirectional) && ws.send(data);
            }
            catch (e) {
                console.log('[WARN]: try to send data over a closed connection.');
                ws && ws.close();
            }
        }
    }

    transactionSyncResponse(content, ws) {
        if (ws.outBound && !ws.bidirectional) {
            return content;
        }

        let payload = {
            type: 'transaction_sync_response',
            content
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.nodeConnectionReady && ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
            ws && ws.close();
        }

        return content;
    }

    transactionSyncRequest(transactionID, options = {}) {
        const {
                  depth          : currentDepth,
                  request_node_id: requestNodeID,
                  routing,
                  priority,
                  dispatch_request  : dispatchRequest,
                  queued            : alreadyQueued,
                  force_request_sync: forceRequestSync,
                  timestamp,
                  attempt
              } = options;

        if (!forceRequestSync && !dispatchRequest && walletSync.hasPendingTransaction(transactionID)) {
            return Promise.resolve();
        }

        wallet.flagTransactionAsRequested(transactionID);

        return (forceRequestSync || options.routing ? Promise.resolve() : walletSync.getTransactionUnresolvedData(transactionID))
            .then(unresolvedTransaction => {
                if (unresolvedTransaction) {
                    return;
                }
                return new Promise((resolve, reject) => {

                    if (!alreadyQueued && !options.routing) {
                        walletSync.add(transactionID, {
                            delay: !dispatchRequest ? 0 : config.NETWORK_LONG_TIME_WAIT_MAX * 10,
                            timestamp,
                            attempt,
                            priority
                        });
                    }

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
                        let timeoutID      = undefined;
                        let nodeID         = ws.nodeID;
                        let startTimestamp = Date.now();
                        try {
                            if (ws.nodeConnectionReady && !(ws.inBound && !ws.bidirectional)) {
                                eventBus.removeAllListeners(`transaction_sync_response:${transactionID}`);
                                eventBus.once(`transaction_sync_response:${transactionID}`, function(eventData) {
                                    clearTimeout(timeoutID);
                                    if (eventData.transaction_not_found) {
                                        console.log(`[peer] transaction id  ${transactionID} not found at node ${nodeID} (${Date.now() - startTimestamp}ms)`);
                                        callback();
                                    }
                                    else {
                                        console.log(`[peer] received transaction id  ${transactionID} sync from node ${nodeID} (${Date.now() - startTimestamp}ms)`);
                                        callback(true);
                                    }
                                });
                                ws.send(data);
                                timeoutID = setTimeout(function() {
                                    console.log(`[peer] timeout transaction id  ${transactionID} sync from node ${nodeID} (${Date.now() - startTimestamp}ms)`);
                                    eventBus.removeAllListeners(`transaction_sync_response:${transactionID}`);
                                    callback();
                                }, Math.round(config.NETWORK_SHORT_TIME_WAIT_MAX));
                            }
                            else {
                                callback();
                            }
                        }
                        catch (e) {
                            console.log('[WARN]: try to send data over a closed connection.');
                            ws && ws.close();
                            clearTimeout(timeoutID);
                            eventBus.removeAllListeners('transaction_sync_response:' + transactionID);
                            callback();
                        }
                    }, (done) => {
                        eventBus.removeAllListeners('transaction_sync_response:' + transactionID);
                        delete this.pendingTransactionSync[transactionID];

                        if (!done) {
                            console.log('[peer] transaction_sync_response:' + transactionID + ' not received. skip...');
                            if (!alreadyQueued && !options.routing) {
                                walletSync.add(transactionID, {
                                    timestamp,
                                    attempt,
                                    priority
                                });
                            }
                        }
                        resolve();
                    });
                });
            });
    }
    
    transactionSyncByWebSocket(transactionID, ws, currentDepth) {
        return walletSync.getTransactionUnresolvedData(transactionID)
                         .then(unresolvedTransaction => {
                             if (unresolvedTransaction) {
                                 return;
                             }

                             return new Promise((resolve) => {

                                 let startTimestamp = Date.now();
                                 let nodeID         = ws.nodeID;

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
                                     if (ws.nodeConnectionReady && !(ws.outBound && !ws.bidirectional)) {
                                         eventBus.removeAllListeners('transaction_sync_response:' + transactionID);

                                         eventBus.once('transaction_sync_response:' + transactionID, function(data, eventWS) {
                                             if (!data.transaction_not_found) {
                                                 console.log(`[peer] transaction id  ${transactionID} not found at node ${nodeID} (${Date.now() - startTimestamp}ms)`);
                                             }
                                         });

                                         ws.send(data);
                                         ws = null;
                                         setTimeout(() => {
                                             console.log(`[peer] timeout transaction id  ${transactionID} sync from node ${nodeID} (${Date.now() - startTimestamp}ms)`);
                                             if (!this.pendingTransactionSync[transactionID]) {
                                                 eventBus.removeAllListeners('transaction_sync_response:' + transactionID);
                                             }
                                         }, Math.round(config.NETWORK_SHORT_TIME_WAIT_MAX));
                                     }
                                 }
                                 catch (e) {
                                     console.log('[WARN]: try to send data over a closed connection.');
                                     ws && ws.close();
                                 }

                                 resolve();
                             });
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

            if (network.nodeList[`${data.node_prefix}${data.node_address}:${data.node_port}`]) {
                return callback();
            }

            network.addNode(data.node_prefix, data.node_address, data.node_port, data.node_port_api, data.node_id);
            callback();
        }, () => {
            nodeRepository.addNodeAttribute(ws.nodeID, 'peer_count', nodes.length)
                          .then(_ => _)
                          .catch(_ => _);
        });
    }

    sendConnectionReady(content, ws) {
        ws.nodeConnectionState = !ws.nodeConnectionState ? 'waiting' : 'open';
        if (ws.nodeConnectionState === 'open') {
            ws.nodeConnectionReady = true;
        }
        let payload = {
            type: 'connection_ready',
            content
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
            ws && ws.close();
        }
    }

    sendNATCheckResponse(content, ws) {
        let payload = {
            type: 'nat_check_response',
            content
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
            ws && ws.close();
        }
    }

    sendNATCheck(content, ws) {
        let payload = {
            type: 'nat_check',
            content
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
            ws && ws.close();
        }
    }

    replyInboundStreamRequest(enabled, ws) {
        let payload = {
            type   : 'inbound_stream_response',
            content: {
                'inbound_stream_enabled': !!enabled
            }
        };

        eventBus.emit('node_event_log', payload);

        let data = JSON.stringify(payload);
        try {
            ws.send(data);
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
            ws && ws.close();
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
            ws && ws.close();
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
            ws && ws.close();
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
                    if (attributeValue) {
                        this.nodeAttributeResponse({
                            node_id       : content.node_id,
                            attribute_type: content.attribute_type,
                            value         : attributeValue
                        }, ws);
                    }
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
            if (!this.nodeAttributeCache[content.node_id]) {
                this.nodeAttributeCache[content.node_id] = {};
            }

            const now = Date.now();
            if (!this.nodeAttributeCache[content.node_id][content.attribute_type]) {
                this.nodeAttributeCache[content.node_id] = {
                    [content.attribute_type]: {
                        value    : content.value,
                        updatedAt: now
                    }
                };
            }
            else {
                this.nodeAttributeCache[content.node_id][content.attribute_type].value = content.value;
                if (now < this.nodeAttributeCache[content.node_id][content.attribute_type].updatedAt + 60000) {
                    return;
                }
                this.nodeAttributeCache[content.node_id][content.attribute_type].updatedAt = now;
            }

            statistics.newEvent('add_or_update_attribute');
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
