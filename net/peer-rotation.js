import network from './network';
import database from '../database/database';
import _ from 'lodash';
import config from '../core/config/config';
import node from '../database/repositories/node';


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
                        randomSetLength = PeerRotation.PROACTIVE_ROTATION_TYPE.DATA_QUANTITY.random_set_length;
                        attributeType   = 'transaction_count';
                    }
                    else {
                        randomSetLength = PeerRotation.PROACTIVE_ROTATION_TYPE.POPULARITY.random_set_length;
                        attributeType   = 'peer_count';
                    }
                    const limit = Math.round(_.keys(network.nodeList).length * randomSetLength);
                    nodeRepository.listNodeAttribute({attribute_type: attributeType}, 'value desc', limit)
                                  .then(candidates => {
                                      candidates = _.filter(candidates, node => node.node_id !== network.nodeID);
                                      return candidates.length === 0 ? Promise.reject() : _.sample(candidates).node_id;
                                  })
                                  .then(nodeID => nodeRepository.getNode({node_id: nodeID}))
                                  .then(node => resolve(node))
                                  .catch(() => resolve());
                    break;
                case PeerRotation.PROACTIVE_ROTATION_TYPE.RANDOM:
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
        return new Promise(resolve => {
            const outboundClients = network.outboundClients;
            let peerToDisconnect;
            if (outboundClients.length < config.NODE_CONNECTION_OUTBOUND_MAX - 1) {
                return network.retryConnectToInactiveNodes();
            }
            else if (outboundClients.length === config.NODE_CONNECTION_OUTBOUND_MAX) {
                peerToDisconnect = this._getOlderPeer();
            }

            this._getNewPeer()
                .then(node => {
                    if (node) {
                        if (peerToDisconnect && peerToDisconnect.close) {
                            peerToDisconnect.onUnregister = () => {
                                network._connectTo(node.node_prefix, node.node_ip_address, node.node_port, node.node_port_api, node.node_id)
                                       .then(() => resolve())
                                       .catch(() => {
                                           this.doRotationProactive().then(() => resolve());
                                       });
                            };
                            peerToDisconnect.close();
                        }
                        else {
                            network._connectTo(node.node_prefix, node.node_ip_address, node.node_port, node.node_port_api, node.node_id)
                                   .then(() => resolve())
                                   .catch(() => {
                                       this.doRotationProactive().then(() => resolve());
                                   });
                        }
                    }
                    else {
                        resolve();
                    }
                });

        });
    }
}


export default new PeerRotation();
