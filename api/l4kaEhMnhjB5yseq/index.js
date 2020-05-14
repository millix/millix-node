import Endpoint from '../endpoint';
import database from '../../database/database';


/**
 * api list_transaction
 */
class _l4kaEhMnhjB5yseq extends Endpoint {
    constructor() {
        super('l4kaEhMnhjB5yseq');
    }

    /**
     *
     * @param app
     * @param req (p0: date_begin, p1: date_end, p2: node_id_origin, p3:
     *     is_stable, p4: is_parent, p5: is_timeout, p6: status, p7:
     *     order_by="create_date desc", p8: record_limit=1000, p9: shard_id)
     * @param res
     */
    handler(app, req, res) {
        const orderBy               = req.query.p7 || 'create_date desc';
        const limit                 = parseInt(req.query.p8) || 1000;
        const shardID               = req.query.p9;
        const transactionRepository = database.getRepository('transaction');
        transactionRepository.listTransactions({
            date_begin    : req.query.p0,
            date_end      : req.query.p1,
            node_id_origin: req.query.p2,
            is_stable     : req.query.p3,
            is_parent     : req.query.p4,
            is_timeout    : req.query.p5,
            status        : req.query.p6
        }, orderBy, limit, shardID)
                             .then(transactions => res.send(transactions));
    }
}


export default new _l4kaEhMnhjB5yseq();
