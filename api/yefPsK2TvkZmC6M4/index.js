import services from '../../core/serices/services';
import Endpoint from '../endpoint';


// api update_job_engine
class _yefPsK2TvkZmC6M4 extends Endpoint {
    constructor() {
        super('yefPsK2TvkZmC6M4');
    }

    handler(app, req, res) {
        if (!req.query.p0) {
            return res.status(400).send({status: 'p0<is_run> is required'});
        }
        const isRun = req.query.p0 === 'true';
        if (isRun && !services.initialized) {
            services.initialize({initialize_wallet_event: true});
            res.send({status: 'success'});
        }
        else if (!isRun && services.initialized) {
            services.stop();
            res.send({status: 'success'});
        }
        else {
            res.send({status: 'not_updated'});
        }
    }
}


export default new _yefPsK2TvkZmC6M4();
