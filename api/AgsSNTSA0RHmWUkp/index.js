import database from '../../database/database';
import Endpoint from '../endpoint';


// api list_node_attribute
class _AgsSNTSA0RHmWUkp extends Endpoint {
    constructor() {
        super('AgsSNTSA0RHmWUkp');
    }

    handler(app, req, res) {
        const limit          = parseInt(req.query.p3) || 1000;
        const nodeRepository = database.getRepository('node');
        nodeRepository.listNodeAttribute({
            node_id          : req.query.p0,
            attribute_type_id: req.query.p1,
            status           : req.query.p2
        }, limit).then(attributeList => {
            res.send(attributeList);
        });
    }
}


export default new _AgsSNTSA0RHmWUkp();
