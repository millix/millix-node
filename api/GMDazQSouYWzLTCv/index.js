import logManager from '../../core/log-manager';
import Endpoint from '../endpoint';
import _ from 'lodash';


/**
 * api list_log
 */
class _GMDazQSouYWzLTCv extends Endpoint {
    constructor() {
        super('GMDazQSouYWzLTCv');
    }

    /**
     * returns a list of log items from the node. it returns the newest records
     * by default
     * @param app
     * @param req (p0: type, p1: content, p2: date_begin, p3: date_end, p4:
     *     order_by="create_date desc", p5: record_limit=1000)
     * @param res
     */
    handler(app, req, res) {
        //TODO: filter the logs, make max log size a config, write logs to file
        // as config too
        const orderBy = req.query.p4 || 'create_date desc';
        const limit   = parseInt(req.query.p5) || 1000;
        let log       = logManager.log.slice(0, limit);
        _.each(log, entry => {
            try {
                entry.content = JSON.parse(entry.content);
            }
            catch (e) {
            }
        });
        res.send({log});
    }
}


export default new _GMDazQSouYWzLTCv();
