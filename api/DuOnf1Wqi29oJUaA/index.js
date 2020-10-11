import network from '../../net/network';
import Endpoint from '../endpoint';
import database from '../../database/database';


/**
 * api new_node
 */
class _DuOnf1Wqi29oJUaA extends Endpoint {
    constructor() {
        super('DuOnf1Wqi29oJUaA');
    }

    /**
     * inserts a new record to table node.
     * @param app
     * @param req (p0: node_prefix<required>, p1: node_address<required>,
     *     p2: node_port<required>, p3: node_port_api<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const {p0: nodePrefix, p1: nodeIpAddress, p2: nodePort, p3: nodePortApi} = req.query;
        if (!nodePrefix || !nodeIpAddress || !nodePort || !nodePortApi) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<node_prefix>, p1<node_address>, p2<node_port> and p3<node_port_api> are required'
            });
        }

        const nodeRepository = database.getRepository('node');
        nodeRepository.addNode({
            node_prefix  : nodePrefix,
            node_address : nodeIpAddress,
            node_port    : nodePort,
            node_port_api: nodePortApi
        }).then(() => {
            network.addNode(nodePrefix, nodeIpAddress, nodePort, nodePortApi);
            res.send({api_status: 'success'});
        }).catch(e => res.send({
            api_status : 'fail',
            api_message: `unexpected generic api error: (${e})`
        }));
    }
}


export default new _DuOnf1Wqi29oJUaA();
