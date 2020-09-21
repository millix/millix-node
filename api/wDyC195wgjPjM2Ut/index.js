import database from '../../database/database';
import Endpoint from '../endpoint';


/**
 * api get_transaction
 */
class _wDyC195wgjPjM2Ut extends Endpoint {
    constructor() {
        super('wDyC195wgjPjM2Ut');
    }

    /**
     * returns a single record from table transaction as indicated by
     * transaction_id in the indicated shard
     * @param app
     * @param req (p0: transaction_id<required>, p1: shard_id<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (!req.query.p0 || !req.query.p1) {
            return res.status(400).send({
                status : 'fail',
                message: 'p0<transaction_id> and p1<shard_id> are required'
            });
        }
        database.firstShardZeroORShardRepository('transaction', req.query.p1, transactionRepository => {
            return new Promise((resolve, reject) => {
                transactionRepository.getTransaction(req.query.p0).then(transaction => transaction ? resolve(transaction) : reject()).catch(reject);
            });
        }).then(transaction => res.send(transaction)).catch(e => res.send(e.message));
    }
}


export default new _wDyC195wgjPjM2Ut();
