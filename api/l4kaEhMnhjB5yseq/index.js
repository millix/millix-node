import wallet from '../../core/wallet/wallet';
import Endpoint from '../endpoint';
import database from '../../database/database';


// api list_transaction
class _l4kaEhMnhjB5yseq extends Endpoint {
    constructor() {
        super('l4kaEhMnhjB5yseq');
    }

    handler(app, req, res) {
        const orderBy               = req.query.p7;
        const limit                 = parseInt(req.query.p8) || 1000;
        const shardID               = req.query.p9;
        const transactionRepository = database.getRepository('transaction');
        transactionRepository.listTransactions({
            begin_date    : req.query.p0,
            end_date      : req.query.p1,
            node_id_origin: req.query.p2,
            is_stable     : req.query.p3,
            is_parent     : req.query.p4,
            is_timeout    : req.query.p5,
            status        : req.query.p6 || 1
        }, orderBy, limit, shardID)
                             .then(transactions => res.send(transactions));
    }
}


export default new _l4kaEhMnhjB5yseq();
