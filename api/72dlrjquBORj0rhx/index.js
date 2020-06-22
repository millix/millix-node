import database from '../../database/database';
import Endpoint from '../endpoint';


/**
 * api list_address
 */
class _72dlrjquBORj0rhx extends Endpoint {
    constructor() {
        super('72dlrjquBORj0rhx');
    }

    /**
     * returns records from table address. it returns the newest records by
     * default
     * @param app
     * @param req (p0: address_base, p1: address_version, p2:
     *     address_key_identifier, p3: address, p4: status, p5:
     *     order_by="create_date desc", p6: record_limit: 1000)
     * @param res
     */
    handler(app, req, res) {
        const orderBy           = req.query.p5 || 'create_date desc';
        const limit             = parseInt(req.query.p6) || 1000;
        const addressRepository = database.getRepository('address');
        addressRepository.listAddress({
            address_base          : req.query.p0,
            address_version       : req.query.p1,
            address_key_identifier: req.query.p2,
            address               : req.query.p3,
            status                : req.query.p4
        }, orderBy, limit)
                         .then(addresses => res.send(addresses));
    }
}


export default new _72dlrjquBORj0rhx();
