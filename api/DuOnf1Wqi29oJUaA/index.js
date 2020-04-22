import network from '../../net/network';
import Endpoint from '../endpoint';


// api new_peer
class _DuOnf1Wqi29oJUaA extends Endpoint{
    constructor() {
        super('DuOnf1Wqi29oJUaA');
    }

    handler(app, req, res) {
        const nodePrefix = req.query.p1;
        const nodeIpAddress = req.query.p2;
        const nodePort = req.query.p3;
        if (nodePrefix && nodeIpAddress && nodePort) {
            network.addNode(nodePrefix, nodeIpAddress, nodePort);
            res.send({success: true});
        }
        else {
            res.send({success: false});
        }
    }
};

export default new _DuOnf1Wqi29oJUaA();
