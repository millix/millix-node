import network from '../../net/network';
import Endpoint from '../endpoint';


/**
 * api toggle_service_network
 */
class _5sgpSNaqnHIcfocl extends Endpoint {
    constructor() {
        super('5sgpSNaqnHIcfocl');
    }

    /**
     * toggles the network service for all networks (main or test networks)
     * between running (true) and not running (false)
     * @param app
     * @param req (p0: is_running<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (!req.query.p0) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<is_running> is required'
            });
        }
        const isOnline = !!req.query.p0;
        if (isOnline && network.initialized === false) {
            network.initialize();
            res.send({api_status: 'success'});
        }
        else if (!isOnline && network.initialized === true) {
            network.stop();
            res.send({api_status: 'success'});
        }
        else {
            res.send({
                api_status : 'fail',
                api_message: 'not updated'
            });
        }
    }
}


export default new _5sgpSNaqnHIcfocl();
