import database from '../../database/database';
import Endpoint from '../endpoint';


// api list_transaction_output
class _FDLyQ5uo5t7jltiQ extends Endpoint {
    constructor() {
        super('FDLyQ5uo5t7jltiQ');
    }

    handler(app, req, res) {
        const orderBy               = req.query.p11;
        const limit                 = parseInt(req.query.p12) || 1000;
        const shardID               = req.query.p13;
        const transactionRepository = database.getRepository('transaction');
        transactionRepository.listTransactionOutput({
            transaction_id        : req.query.p0,
            begin_date            : req.query.p1,
            end_date              : req.query.p2,
            address_key_identifier: req.query.p4,
            is_double_spend       : req.query.p5,
            double_spend_date     : req.query.p6,
            is_stable             : req.query.p7,
            stable_date           : req.query.p8,
            is_spent              : req.query.p9,
            spent_date            : req.query.p10
        }, orderBy, limit, shardID).then(transactionOutputList => {
            res.send(transactionOutputList);
        });
    }
}


export default new _FDLyQ5uo5t7jltiQ();
