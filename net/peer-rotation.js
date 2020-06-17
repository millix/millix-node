import network from './network';
import database from '../database/database';
import _ from 'lodash';
import config from '../core/config/config';
import node from '../database/repositories/node';
import WebSocket from 'ws';
import console from '../core/console';
import async from 'async';


export class PeerRotation {
    static PROACTIVE_ROTATION_TYPE = {
        DATA_QUANTITY: {
            type             : 'DATA_QUANTITY',
            frequency        : 0.25,
            random_set_length: config.PEER_ROTATION_MORE_THAN_AVERAGE
        },
        POPULARITY   : {
            type             : 'POPULARITY',
            frequency        : 0.25,
            random_set_length: config.PEER_ROTATION_MORE_THAN_AVERAGE
        },
        RANDOM       : {
            type     : 'RANDOM',
            frequency: 0.5
        }
    };

    constructor() {
    }

    _weightedRandom(prob) {
        let i, sum = 0, r = Math.random();
        for (i in prob) {
            if (prob.hasOwnProperty(i)) {
                sum += prob[i].frequency;
                if (r <= sum) {
                    return PeerRotation.PROACTIVE_ROTATION_TYPE[i];
                }
            }
        }
    }

    _getOlderPeer() {
        const peers = network.outboundClients;
        if (peers.length === 0) {
            return null;
        }
        return _.minBy(peers, ws => ws.createTime);
    }

    _getNewPeer() {
        return new Promise(resolve => {
            const nodeRepository = database.getRepository('node');
            const method         = this._weightedRandom(PeerRotation.PROACTIVE_ROTATION_TYPE);
            switch (method) {
                case PeerRotation.PROACTIVE_ROTATION_TYPE.DATA_QUANTITY:
                case PeerRotation.PROACTIVE_ROTATION_TYPE.POPULARITY:
                    let randomSetLength;
                    let attributeType;
                    if (method === PeerRotation.PROACTIVE_ROTATION_TYPE.DATA_QUANTITY) {
                        console.log(`[peer-rotation] get new peer using method PeerRotation.PROACTIVE_ROTATION_TYPE.DATA_QUANTITY`);
                        randomSetLength = PeerRotation.PROACTIVE_ROTATION_TYPE.DATA_QUANTITY.random_set_length;
                        attributeType   = 'transaction_count';
                    }
                    else {
                        console.log(`[peer-rotation] get new peer using method PeerRotation.PROACTIVE_ROTATION_TYPE.POPULARITY`);
                        randomSetLength = PeerRotation.PROACTIVE_ROTATION_TYPE.POPULARITY.random_set_length;
                        attributeType   = 'peer_count';
                    }
                    const limit = Math.round(_.keys(network.nodeList).length * randomSetLength);
                    nodeRepository.listNodeAttribute({attribute_type: attributeType}, 'value desc', limit)
                                  .then(candidates => {
                                      candidates = _.shuffle(_.filter(candidates, node => node.node_id !== network.nodeID));
                                      console.log(`[peer-rotation] list of candidates with ${candidates.length} nodes`);
                                      if (candidates.length === 0) {
                                          return Promise.reject();
                                      }
                                      return new Promise(resolve => {
                                          async.eachSeries(candidates, (candidate, callback) => {
                                              nodeRepository.getNode({
                                                  node_id: candidate.node_id,
                                                  status : 1
                                              }).then(node => callback(node)).catch(_ => callback());
                                          }, node => {
                                              resolve(node);
                                          });
                                      });
                                  })
                                  .then(node => resolve(node))
                                  .catch(() => resolve());
                    break;
                case PeerRotation.PROACTIVE_ROTATION_TYPE.RANDOM:
                    console.log(`[peer-rotation] get new peer using method PeerRotation.PROACTIVE_ROTATION_TYPE.RANDOM`);
                    nodeRepository.listNodes({status: 1}, 'RANDOM()', 1)
                                  .then(([node]) => {
                                      return resolve(node);
                                  });
                    break;
                default:
                    resolve();
            }
        });
    }

    doRotationProactive() {
        console.log('[peer-rotation] start job');
        return new Promise(resolve => {
            const outboundClients = network.outboundClients;
            let peerToDisconnect;
            if (outboundClients.length < config.NODE_CONNECTION_OUTBOUND_MAX - 1) {
                console.log(`[peer-rotation] fill available slots (${outboundClients.length} of ${config.NODE_CONNECTION_OUTBOUND_MAX})`);
                return network.retryConnectToInactiveNodes()
                              .then(() => resolve());
            }
            else if (outboundClients.length === config.NODE_CONNECTION_OUTBOUND_MAX) {
                peerToDisconnect = this._getOlderPeer();
            }

            this._getNewPeer()
                .then(node => {
                    if (node) {
                        console.log(`[peer-rotation] new peer found ${node.node_id} - ${node.node_ip_address}`);
                        if (peerToDisconnect && peerToDisconnect.close) {

                            let handlerID;
                            peerToDisconnect.onUnregister = () => {
                                clearTimeout(handlerID);
                                network._connectTo(node.node_prefix, node.node_ip_address, node.node_port, node.node_port_api, node.node_id)
                                       .then(() => resolve())
                                       .catch(() => {
                                           this.doRotationProactive().then(() => resolve());
                                       });
                            };
                            handlerID                     = setTimeout(() => {
                                peerToDisconnect.onUnregister = null;
                                resolve();
                            }, 1000);

                            console.log(`[peer-rotation] drop with node id ${peerToDisconnect.nodeID} - ${peerToDisconnect.url}`);

                            if (peerToDisconnect.readyState === WebSocket.CLOSED || peerToDisconnect.readyState === WebSocket.CLOSING) {
                                network._unregisterWebsocket(peerToDisconnect);
                            }
                            else {
                                peerToDisconnect.close();
                            }
                        }
                        else {
                            console.log(`[peer-rotation] no connection to be drop`);
                            network._connectTo(node.node_prefix, node.node_ip_address, node.node_port, node.node_port_api, node.node_id)
                                   .then(() => resolve())
                                   .catch(() => {
                                       this.doRotationProactive().then(() => resolve());
                                   });
                        }
                    }
                    else {
                        console.log(`[peer-rotation] no new peer found`);
                        resolve();
                    }
                });

        });
    }
}


export default new PeerRotation();
