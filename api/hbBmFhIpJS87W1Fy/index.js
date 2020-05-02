import database from '../../database/database';
import Endpoint from '../endpoint';


// api get_transaction_input
class _hbBmFhIpJS87W1Fy extends Endpoint {
    constructor() {
        super('hbBmFhIpJS87W1Fy');
    }

    handler(app, req, res) {
        if (!req.query.p0 || !req.query.p1) {
            return res.status(400).send({status: 'p0<transaction_id> and p1<input_position> are required'});
        }
        const transactionRepository = database.getRepository('transaction');
        transactionRepository.getTransactionInput({
            transaction_id: req.query.p0,
            input_position: req.query.p1
        }).then(transactionInput => {
            res.send(transactionInput || {});
        });
    }
}


export default new _hbBmFhIpJS87W1Fy();
