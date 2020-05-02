import database from '../../database/database';
import Endpoint from '../endpoint';


// api list_transaction_input
class _I3EoELuQCmqwvp8C extends Endpoint {
    constructor() {
        super('I3EoELuQCmqwvp8C');
    }

    handler(app, req, res) {
        const orderBy               = req.query.p8;
        const limit                 = parseInt(req.query.p9) || 1000;
        const shardID               = req.query.p10;
        const transactionRepository = database.getRepository('transaction');
        transactionRepository.listTransactionInput({
            transaction_id        : req.query.p0,
            begin_date            : req.query.p1,
            end_date              : req.query.p2,
            address_key_identifier: req.query.p4,
            is_double_spend       : req.query.p5,
            double_spend_date     : req.query.p6,
            output_transaction_id : req.query.p7
        }, orderBy, limit, shardID).then(transactionInputList => {
            res.send(transactionInputList);
        });
    }
}


export default new _I3EoELuQCmqwvp8C();
