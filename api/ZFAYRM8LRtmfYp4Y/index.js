import Endpoint from '../endpoint';
import server from '../server';


/**
 * api get_node_id
 */
class _ZFAYRM8LRtmfYp4Y extends Endpoint {
    constructor() {
        super('ZFAYRM8LRtmfYp4Y');
    }

    /**
     * identifies the node_id responding to the request at the provided IP
     * address and api port an address
     * @param app
     * @param req
     * @param res
     * @returns {node_id}
     */
    handler(app, req, res) {
        res.send({node_id: server.nodeID});
    }
}


export default new _ZFAYRM8LRtmfYp4Y();
