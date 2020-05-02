import database from '../../database/database';
import Endpoint from '../endpoint';


// api list_address
class _72dlrjquBORj0rhx extends Endpoint {
    constructor() {
        super('72dlrjquBORj0rhx');
    }

    handler(app, req, res) {
        const orderBy           = req.query.p5;
        const limit             = parseInt(req.query.p6) || 1000;
        const addressRepository = database.getRepository('address');
        addressRepository.listAddress({
            address_base          : req.query.p0,
            address_version       : req.query.p1,
            address_key_identifier: req.query.p2,
            address               : req.query.p3,
            status                : req.query.p4 || 1
        }, orderBy, limit)
                         .then(addresses => res.send(addresses));
    }
}


export default new _72dlrjquBORj0rhx();
