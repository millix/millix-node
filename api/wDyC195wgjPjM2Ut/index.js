import database from '../../database/database';
import Endpoint from '../endpoint';
import peer from '../../net/peer';


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
        }).then(transaction => {
            if (!transaction) {
                peer.transactionSyncRequest(req.query.p0).then(_ => _).catch(_ => _);
                return res.send({
                    status : 'transaction_not_found',
                    message: `the transaction with id ${req.query.p0} was not found at shard ${req.query.p1}`
                });
            }

            if (!!transaction.transaction_date) {
                transaction['transaction_date'] = Math.floor(transaction.transaction_date.getTime() / 1000);
            }
            res.send(transaction || {});
        }).catch(e => res.send(e.message));
    }
}


export default new _wDyC195wgjPjM2Ut();
