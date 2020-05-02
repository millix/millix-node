import database from '../../database/database';
import Endpoint from '../endpoint';


// api get_transaction_output
class _KN2ZttYDEKzCulEZ extends Endpoint {
    constructor() {
        super('KN2ZttYDEKzCulEZ');
    }

    handler(app, req, res) {
        if (!req.query.p0 || !req.query.p1) {
            return res.status(400).send({status: 'p0<transaction_id> and p1<output_position> are required'});
        }
        const transactionRepository = database.getRepository('transaction');
        transactionRepository.getTransactionOutput({
            transaction_id : req.query.p0,
            output_position: req.query.p1
        }).then(transactionOutput => {
            res.send(transactionOutput || {});
        });
    }
}


export default new _KN2ZttYDEKzCulEZ();
