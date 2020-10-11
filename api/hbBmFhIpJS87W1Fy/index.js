import database from '../../database/database';
import Endpoint from '../endpoint';


/**
 * api get_transaction_input
 */
class _hbBmFhIpJS87W1Fy extends Endpoint {
    constructor() {
        super('hbBmFhIpJS87W1Fy');
    }

    /**
     * returns a single record from table transaction_input as indicated by
     * transaction_id and input_position in the indicated shard
     * @param app
     * @param req (p0: transaction_id<required>, p1: input_position<required>,
     *     p2: shard_id<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (!req.query.p0 || !req.query.p1 || !req.query.p2) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<transaction_id>, p1<input_position>, p2<shard_id> are required'
            });
        }

        database.firstShardORShardZeroRepository('transaction', req.query.p2, transactionRepository => {
            return transactionRepository.getTransactionInput({
                transaction_id: req.query.p0,
                input_position: req.query.p1,
                shard_id      : req.query.p2
            });
        }).then(transactionInput => {
            res.send(transactionInput || {
                api_status : 'fail',
                api_message: `the transaction input ${req.query.p1} of transaction id ${req.query.p0} was not found at shard with id ${req.query.p2}`
            });
        }).catch(e => res.send({
            api_status : 'fail',
            api_message: `unexpected generic api error: (${e})`
        }));
    }
}


export default new _hbBmFhIpJS87W1Fy();
