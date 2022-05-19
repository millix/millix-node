import Endpoint from '../endpoint';
import logManager from '../../core/log-manager';


/**
 * api event_log_list
 */
class _PZ7x3HVHVstLNYf0 extends Endpoint {
    constructor() {
        super('PZ7x3HVHVstLNYf0');
    }

    /**
     * returns event log list
     * @param app
     * @param req (p0: log_limit=1000)
     * @param res
     */
    handler(app, req, res) {
        const limit = parseInt(req.query.p0) || 1000;
        res.send({
            api_status    : 'success',
            event_log_list: logManager.getLog(limit)
        });
    }
}


export default new _PZ7x3HVHVstLNYf0();
