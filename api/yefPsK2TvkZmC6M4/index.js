import services from '../../core/services/services';
import Endpoint from '../endpoint';


/**
 * api toggle_service_node
 */
class _yefPsK2TvkZmC6M4 extends Endpoint {
    constructor() {
        super('yefPsK2TvkZmC6M4');
    }

    /**
     * toggles the node service between running (true) and not running (false)
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
        const isRun = req.query.p0 === 'true';
        if (isRun && !services.initialized) {
            services.initialize({initialize_wallet_event: true});
            res.send({api_status: 'success'});
        }
        else if (!isRun && services.initialized) {
            services.stop();
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


export default new _yefPsK2TvkZmC6M4();
