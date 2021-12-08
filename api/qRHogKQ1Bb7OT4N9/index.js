import network from "../../net/network";
import Endpoint from "../endpoint";

/**
 * api get_node_public_ip
 */
class _qRHogKQ1Bb7OT4N9 extends Endpoint {
    constructor() {
        super('qRHogKQ1Bb7OT4N9');
    }

    handler(app, req, res) {
        res.send({
            node_public_ip: network.nodePublicIp
        })
    }
}

export default new _qRHogKQ1Bb7OT4N9();