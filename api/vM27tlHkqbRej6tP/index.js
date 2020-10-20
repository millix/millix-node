import database from '../../database/database';
import Endpoint from '../endpoint';
import network from '../../net/network';
import _ from 'lodash';


/**
 * api list_node_memory_extended
 */
class _vM27tlHkqbRej6tP extends Endpoint {
    constructor() {
        super('vM27tlHkqbRej6tP');
    }

    /**
     * returns a list of all peer nodes (node table and memory list) known by
     * the host.  it returns the newest records by default
     * @param app
     * @param req (p0: status, p1: order_by="create_date desc", p2:
     *     record_limit=1000)
     * @param res
     */
    handler(app, req, res) {
        const status         = !!req.query.p0 ? req.query.p0 : undefined;
        const orderBy        = req.query.p1 || 'create_date desc';
        const limit          = parseInt(req.query.p2) || 1000;
        const nodeRepository = database.getRepository('node');

        let keyMap = {
            'attribute_create_date': 'create_date',
            'attribute_status'     : 'status'
        };

        const keyMapFunction = (v, k) => keyMap[k] ? keyMap[k] : k;

        nodeRepository.listNodesExtended()
                      .then(nodes => {
                          let result    = [];
                          const nodeMap = {};
                          nodes.forEach(node => {
                              let nodeItem = nodeMap[node.node_id];
                              if (!nodeItem) {
                                  nodeItem                        = _.pick(node, 'node_id', 'node_prefix', 'node_address', 'node_port', 'node_port_api', 'status', 'update_date', 'create_date');
                                  nodeItem['node_attribute_list'] = [];
                                  nodeMap[node.node_id]           = nodeItem;
                                  if (status !== undefined && parseInt(status) !== nodeItem.status) {
                                      return;
                                  }
                                  result.push(nodeItem);
                              }

                              // process attribute
                              let attribute = _.mapKeys(_.pick(node, 'attribute_type_id', 'value', 'attribute_status', 'attribute_create_date', 'attribute_type'), keyMapFunction);
                              if (!!attribute.attribute_type_id) {
                                  try {
                                      attribute['value'] = JSON.parse(attribute.value);
                                  }
                                  catch {
                                  }

                                  nodeItem['node_attribute_list'].push(attribute);
                              }
                          });

                          if (status === undefined || status === '-1') {
                              _.values(network.nodeList).forEach(node => {
                                  if (!nodeMap[node.node_id]) {
                                      let nodeItem                    = _.pick(node, 'node_id', 'node_prefix', 'node_address', 'node_port', 'node_port_api', 'status', 'update_date', 'create_date');
                                      nodeItem['node_attribute_list'] = [];
                                      nodeMap[node.node_id]           = nodeItem;
                                      result.push(nodeItem);
                                  }
                              });
                          }

                          if (orderBy) {
                              const regExp = /^(?<column>\w+) (?<order>asc|desc)$/.exec(orderBy);
                              if (regExp && regExp.groups && regExp.groups.column && regExp.groups.order) {
                                  result = _.orderBy(result, regExp.groups.column, regExp.groups.order);
                              }
                          }

                          res.send(_.slice(result, 0, limit));
                      })
                      .catch(e => res.send({
                          api_status : 'fail',
                          api_message: `unexpected generic api error: (${e})`
                      }));
    }
}


export default new _vM27tlHkqbRej6tP();
