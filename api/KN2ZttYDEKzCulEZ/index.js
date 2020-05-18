import database from '../../database/database';
import Endpoint from '../endpoint';


// api get_transaction_output
class _KN2ZttYDEKzCulEZ extends Endpoint {
    constructor() {
        super('KN2ZttYDEKzCulEZ');
    }

    /**
     * returns a single record from table transaction_output as indicated by
     * transaction_id and output_position in the indicated shard
     * @param app
     * @param req (p0: transaction_id<required, p1: output_position<required>,
     *     p2: shard_id<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (!req.query.p0 || !req.query.p1 || !req.query.p2) {
            return res.status(400).send({
                status : 'fail',
                message: 'p0<transaction_id>, p1<output_position> and p2<shard_id> are required'
            });
        }
        const transactionRepository = database.getRepository('transaction', req.query.p2);
        if (!transactionRepository) {
            return res.send({});
        }
        transactionRepository.getTransactionOutput({
            transaction_id : req.query.p0,
            output_position: req.query.p1
        }).then(transactionOutput => {
            res.send(transactionOutput || {});
        });
    }
}


export default new _KN2ZttYDEKzCulEZ();
