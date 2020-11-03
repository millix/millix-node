import database from '../../database/database';
import Endpoint from '../endpoint';
import peer from '../../net/peer';
import walletSync from '../../core/wallet/wallet-sync';


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
                api_status : 'fail',
                api_message: 'p0<transaction_id> and p1<shard_id> are required'
            });
        }
        database.firstShardORShardZeroRepository('transaction', req.query.p1, transactionRepository => {
            return transactionRepository.getTransaction(req.query.p0, req.query.p1);
        }).then(transaction => {
            if (!transaction) {
                peer.transactionSyncRequest(req.query.p0).then(_ => _).catch(_ => _);
                return this._getErrorStatus(req.query.p0)
                           .then(errorStatus => res.send({
                               api_status : errorStatus,
                               api_message: `the transaction with id ${req.query.p0} was not found at shard ${req.query.p1}`
                           }));
            }

            if (!!transaction.transaction_date) {
                transaction['transaction_date'] = Math.floor(transaction.transaction_date.getTime() / 1000);
            }
            res.send(transaction);
        }).catch(e => res.send({
            api_status : 'fail',
            api_message: `unexpected generic api error: (${e})`
        }));
    }

    _getErrorStatus(transactionID) {
        return walletSync.getTransactionData(transactionID)
                         .then((data) => {
                             if (!data) {
                                 return 'fail:not_found';
                             }
                             else if (data.type === 'sync') {
                                 return 'fail:not_found:pending';
                             }
                             else if (data.type === 'unresolved') {
                                 return 'fail:not_found:timeout';
                             }
                             else {
                                 throw new Error('unexpected error');
                             }
                         });
    }
}


export default new _wDyC195wgjPjM2Ut();
