import network from '../../net/network';
import Endpoint from '../endpoint';


// api update_network_state
class _5sgpSNaqnHIcfocl extends Endpoint {
    constructor() {
        super('5sgpSNaqnHIcfocl');
    }

    handler(app, req, res) {
        let data;
        try {
            data = JSON.parse(req.query.p1);
        }
        catch (e) {
            return res.status(400).send({
                success: false,
                message: 'payload is missing or invalid'
            });
        }
        if (data.online && network.initialized === false) {
            network.initialize();
            res.send({success: true});
        }
        else if (!data.online && network.initialized === true) {
            network.stop();
            res.send({success: true});
        }
        else {
            res.send({success: false});
        }
    }
}


export default new _5sgpSNaqnHIcfocl();
