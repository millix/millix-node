import network from '../../net/network';
import Endpoint from '../endpoint';


// api update_network_state
class _5sgpSNaqnHIcfocl extends Endpoint {
    constructor() {
        super('5sgpSNaqnHIcfocl');
    }

    handler(app, req, res) {
        if (!req.query.p0) {
            return res.status(400).send({status: 'p0<is_online> is required'});
        }
        const isOnline = req.query.p0 === 'true';
        if (isOnline && network.initialized === false) {
            network.initialize();
            res.send({status: 'success'});
        }
        else if (!isOnline && network.initialized === true) {
            network.stop();
            res.send({status: 'success'});
        }
        else {
            res.send({status: 'not_updated'});
        }
    }
}


export default new _5sgpSNaqnHIcfocl();
