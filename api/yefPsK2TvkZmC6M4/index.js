import services from '../../core/serices/services';
import Endpoint from '../endpoint';


// api update_job_engine
class _yefPsK2TvkZmC6M4 extends Endpoint {
    constructor() {
        super('yefPsK2TvkZmC6M4');
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
        if (data.run && !services.initialized) {
            services.initialize({initialize_wallet_event: true});
            res.send({success: true});
        }
        else if (!data.run && services.initialized) {
            services.stop();
            res.send({success: true});
        }
        else {
            res.send({success: false});
        }
    }
}


export default new _yefPsK2TvkZmC6M4();
