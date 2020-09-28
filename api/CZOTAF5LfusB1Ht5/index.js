import database from '../../database/database';
import Endpoint from '../endpoint';


/**
 * api list_config_private
 */
class _CZOTAF5LfusB1Ht5 extends Endpoint {
    constructor() {
        super('CZOTAF5LfusB1Ht5');
    }

    /**
     * returns private config values that are only available to the node
     * operator
     * @param app
     * @param req (p0: type, p1: status, p2: order_by="create_date desc", p3:
     *     record_limit=1000)
     * @param res
     */
    handler(app, req, res) {
        const orderBy                 = req.query.p2 || 'create_date desc';
        const limit                   = parseInt(req.query.p3) || 1000;
        const configurationRepository = database.getRepository('config');
        configurationRepository.list({
            type  : req.query.p0,
            status: req.query.p1
        }, orderBy, limit)
                               .then(configurations => res.send(configurations))
                               .catch(e => res.send({
                                   api_status : 'fail',
                                   api_message: `unexpected generic api error: (${e})`
                               }));
    }
}


export default new _CZOTAF5LfusB1Ht5();
