import database from '../../database/database';
import Endpoint from '../endpoint';


// api list_config
class _CZOTAF5LfusB1Ht5 extends Endpoint {
    constructor() {
        super('CZOTAF5LfusB1Ht5');
    }

    handler(app, req, res) {
        const orderBy = req.query.p2;
        const limit   = parseInt(req.query.p3) || 1000;
        const configurationRepository = database.getRepository('config');
        configurationRepository.list({
            type  : req.query.p0,
            status: req.query.p1 || 1
        }, orderBy, limit)
                               .then(configurations => res.send(configurations));
    }
}

export default new _CZOTAF5LfusB1Ht5();
