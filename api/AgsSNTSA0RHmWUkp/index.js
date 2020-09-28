import database from '../../database/database';
import Endpoint from '../endpoint';


/**
 * api list_node_attribute
 */
class _AgsSNTSA0RHmWUkp extends Endpoint {
    constructor() {
        super('AgsSNTSA0RHmWUkp');
    }

    /**
     * returns records from table node_attributes.  it returns the newest
     * records by default
     * @param app
     * @param req (p0: node_id, p1: attribute_type_id, p2: status, p3:
     *     order_by="create_date desc", p4: record_limit=1000)
     * @param res
     */
    handler(app, req, res) {
        const orderBy        = req.query.p3 || 'create_date desc';
        const limit          = parseInt(req.query.p4) || 1000;
        const nodeRepository = database.getRepository('node');
        nodeRepository.listNodeAttribute({
            node_id          : req.query.p0,
            attribute_type_id: req.query.p1,
            status           : req.query.p2
        }, orderBy, limit).then(attributeList => {
            res.send(attributeList);
        }).catch(e => res.send({
            api_status : 'fail',
            api_message: `unexpected generic api error: (${e})`
        }));
    }
}


export default new _AgsSNTSA0RHmWUkp();
