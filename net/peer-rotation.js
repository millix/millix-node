import network from './network';
import database from '../database/database';
import _ from 'lodash';
import config from '../core/config/config';
import node from '../database/repositories/node';
import WebSocket from 'ws';
import console from '../core/console';
import async from 'async';


export class PeerRotation {
    static ROTATION_TYPE = {
        PROACTIVE: {
            DATA_QUANTITY: {},
            POPULARITY   : {},
            RANDOM       : {}
        },
        REACTIVE : {}
    };

    constructor() {
        this._peerRotationStarted = false;
        this.initialized          = false;
    }

    initialize() {
        if (this.initialized) {
            return Promise.resolve();
        }
        this.initialized = true;
        return new Promise(resolve => {
            let nodeRepository = database.getRepository('node');
            nodeRepository
                .getNodeAttribute(network.nodeID, 'peer_rotation_settings')
                .then(attribute => attribute ? resolve(attribute) : Promise.reject())
                .catch(() => {
                    let attribute = JSON.stringify(config.PEER_ROTATION_CONFIG).toLowerCase();
                    nodeRepository.addNodeAttribute(network.nodeID, 'peer_rotation_settings', attribute)
                                  .then(() => resolve(attribute));
                });
        }).then(attribute => {
            attribute = JSON.parse(attribute);
            _.each(_.keys(attribute), rotationType => {
                const rotationTypeConst = rotationType.toUpperCase();
                if (PeerRotation.ROTATION_TYPE[rotationTypeConst]) {
                    const rotationAttribute    = attribute[rotationType];
                    const rotationTypeSettings = PeerRotation.ROTATION_TYPE[rotationTypeConst];
                    _.each(_.keys(rotationAttribute), rotationAttributeType => {
                        const rotationAttributeTypeConst = rotationAttributeType.toUpperCase();
                        if (rotationAttributeType !== 'frequency' && rotationTypeSettings[rotationAttributeTypeConst]) {
                            const rotationTypeSettingsAttribute        = rotationTypeSettings[rotationAttributeTypeConst];
                            const rotationAttributeSettings            = rotationAttribute[rotationAttributeType];
                            rotationTypeSettingsAttribute['frequency'] = rotationAttributeSettings.frequency;
                            if (rotationAttributeSettings.random_set_length !== undefined) {
                                rotationTypeSettingsAttribute['random_set_length'] = config[rotationAttributeSettings.random_set_length.toUpperCase()];
                            }
                        }
                    });
                    rotationTypeSettings['frequency'] = rotationAttribute.frequency;
                }
            });
        });
    }

    stop() {
        this.initialized = false;
    }

    _weightedRandom(prob) {
        let i, sum = 0, r = Math.random();
        for (i in prob) {
            if (prob.hasOwnProperty(i)) {
                sum += prob[i].frequency;
                if (r <= sum) {
                    return prob[i];
                }
            }
        }
    }

    _getOlderPeer() {
        const peers = network.registeredClients;
        if (peers.length === 0) {
            return null;
        }
        return _.minBy(_.filter(peers, peer => (peer.outBound || peer.inBound && peer.bidirectional) && !config.NODE_CONNECTION_STATIC.includes(peer.nodeID)), peer => peer.createTime);
    }

    _getOlderPeerNotSupportingCommonShards() {
        return new Promise(resolve => {
            const peers = network.outboundClients;
            if (peers.length === 0) {
                return null;
            }
            const nodeRepository = database.getRepository('node');
            async.mapSeries(peers, (peer, callback) => {
                nodeRepository.listNodeAttribute({
                    attribute_type: 'shard_protocol',
                    node_id       : peer.nodeID
                }).then(([shardAttribute]) => callback(null, shardAttribute));
            }, (err, nodeShardAttributeList) => {
                const candidates = new Set(_.map(_.filter(nodeShardAttributeList, shardAttributeList => {
                    if (!shardAttributeList) {
                        return false;
                    }
                    else if (!shardAttributeList.value) {
                        return true;
                    }
                    const supportedShardList = shardAttributeList.value;
                    return !_.some(_.map(supportedShardList, supportedShard => supportedShard.is_required && _.has(database.shards, supportedShard.shard_id)));
                }), node => node.node_id));
                return resolve(_.minBy(_.filter(peers, peer => candidates.has(peer.nodeID) && !config.NODE_CONNECTION_STATIC.includes(peer.nodeID)), ws => ws.createTime));
            });
        });
    }

    _getNewPeerProactive() {
        return new Promise(resolve => {
            const nodeRepository = database.getRepository('node');
            const method         = this._weightedRandom(PeerRotation.ROTATION_TYPE.PROACTIVE);
            switch (method) {
                case PeerRotation.ROTATION_TYPE.PROACTIVE.DATA_QUANTITY:
                case PeerRotation.ROTATION_TYPE.PROACTIVE.POPULARITY:
                    let randomSetLength;
                    let attributeType;
                    if (method === PeerRotation.ROTATION_TYPE.PROACTIVE.DATA_QUANTITY) {
                        console.log(`[peer-rotation] get new peer using method PeerRotation.PROACTIVE_ROTATION_TYPE.DATA_QUANTITY`);
                        randomSetLength = PeerRotation.ROTATION_TYPE.PROACTIVE.DATA_QUANTITY.random_set_length;
                        attributeType   = 'transaction_count';
                    }
                    else {
                        console.log(`[peer-rotation] get new peer using method PeerRotation.PROACTIVE_ROTATION_TYPE.POPULARITY`);
                        randomSetLength = PeerRotation.ROTATION_TYPE.PROACTIVE.POPULARITY.random_set_length;
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
                case PeerRotation.ROTATION_TYPE.PROACTIVE.RANDOM:
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

    _getNewPeerReactive() {
        return new Promise(resolve => {
            const nodeRepository = database.getRepository('node');
            nodeRepository.listNodeAttribute({attribute_type: 'shard_protocol'})
                          .then(nodeShardAttributeList => {
                              const candidates = _.shuffle(_.filter(nodeShardAttributeList, shardAttributeList => {
                                  const supportedShardList = shardAttributeList.value;
                                  return node.node_id !== network.nodeID && _.some(_.map(supportedShardList, supportedShard => supportedShard.is_required && _.has(database.shards, supportedShard.shard_id)));
                              }));
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
        });
    }

    doPeerRotation() {
        if (this._peerRotationStarted || !this.initialized) {
            return Promise.resolve();
        }

        this._peerRotationStarted = true;

        console.log('[peer-rotation] start new peer rotation');

        return new Promise(resolve => {
            const outboundClients = network.outboundClients;
            if (outboundClients.length < config.NODE_CONNECTION_OUTBOUND_MAX - 1) {
                console.log(`[peer-rotation] fill available slots (${outboundClients.length} of ${config.NODE_CONNECTION_OUTBOUND_MAX})`);
                console.log('[peer-rotation] peer rotation done.');
                this._peerRotationStarted = false;
                network.retryConnectToInactiveNodes();
                resolve();
            }

            const method = this._weightedRandom(PeerRotation.ROTATION_TYPE);
            let rotation;
            switch (method) {
                case PeerRotation.ROTATION_TYPE.PROACTIVE:
                    console.log('[peer-rotation] selected mode is PeerRotation.ROTATION_TYPE.PROACTIVE');
                    rotation = this.doRotationProactive.bind(this);
                    break;
                default: // REACTIVE
                    console.log('[peer-rotation] selected mode is PeerRotation.ROTATION_TYPE.REACTIVE');
                    rotation = this.doRotationReactive.bind(this);
                    break;
            }

            return rotation()
                .then(([node, peerToDisconnect]) => {
                    if (node) {
                        console.log(`[peer-rotation] new peer found ${node.node_id} - ${node.node_address}`);
                        if (peerToDisconnect && peerToDisconnect.close) {

                            let handlerID;
                            peerToDisconnect.onUnregister = () => {
                                clearTimeout(handlerID);
                                network._connectTo(node.node_prefix, node.node_address, node.node_port, node.node_port_api, node.node_id)
                                       .then(() => {
                                           console.log('[peer-rotation] peer rotation done.');
                                           this._peerRotationStarted = false;
                                           resolve();
                                       })
                                       .catch(e => {
                                           console.log('[peer-rotation] connection error: ', e);
                                           console.log('[peer-rotation] peer rotation done.');
                                           this._peerRotationStarted = false;
                                           resolve();
                                       });
                            };
                            handlerID                     = setTimeout(() => {
                                peerToDisconnect.onUnregister = null;
                                console.log('[peer-rotation] peer rotation done.');
                                this._peerRotationStarted = false;
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
                            network._connectTo(node.node_prefix, node.node_address, node.node_port, node.node_port_api, node.node_id)
                                   .then(() => {
                                       console.log('[peer-rotation] peer rotation done.');
                                       this._peerRotationStarted = false;
                                       resolve();
                                   })
                                   .catch(e => {
                                       console.log('[peer-rotation] connection error: ', e);
                                       console.log('[peer-rotation] peer rotation done.');
                                       this._peerRotationStarted = false;
                                       resolve();
                                   });
                        }
                    }
                    else {
                        console.log(`[peer-rotation] no new peer found`);
                        console.log('[peer-rotation] peer rotation done.');
                        this._peerRotationStarted = false;
                        resolve();
                    }
                });
        });
    }

    doRotationReactive() {
        const outboundClients = network.outboundClients;

        if (outboundClients.length >= config.NODE_CONNECTION_OUTBOUND_MAX) {
            return this._getOlderPeerNotSupportingCommonShards()
                       .then(peerToDisconnect => peerToDisconnect ? peerToDisconnect : this._getOlderPeer())
                       .then(peerToDisconnect => this._getNewPeerReactive()
                                                     .then(node => ([
                                                         node,
                                                         peerToDisconnect
                                                     ])));
        }
        else {
            return this._getNewPeerReactive()
                       .then(node => ([
                           node,
                           undefined
                       ]));
        }
    }

    doRotationProactive() {
        const outboundClients = network.outboundClients;
        let peerToDisconnect;
        if (outboundClients.length >= config.NODE_CONNECTION_OUTBOUND_MAX) {
            peerToDisconnect = this._getOlderPeer();
        }

        return this._getNewPeerProactive()
                   .then(node => ([
                       node,
                       peerToDisconnect
                   ]));
    }
}


export default new PeerRotation();
