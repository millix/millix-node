import Endpoint from '../endpoint';
import database from '../../database/database';
import peer from '../../net/peer';
import walletUtils from '../../core/wallet/wallet-utils';


/**
 * api is_transaction_data_valid
 */
class _K9wxNE4Ved38xhJm extends Endpoint {
    constructor() {
        super('K9wxNE4Ved38xhJm');
    }

    /**
     * returns HTTP 200 if data is correct, HTTP 201 if data is invalid and
     * needs to be fetched again, HTTP 404 if transaction data is not
     * available.
     * @param app
     * @param req (p0: transaction_id<required>, p1: shard_id<required>)
     * @param res
     */
    handler(app, req, res) {
        if (!req.query.p0 || !req.query.p1) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<transaction_id> and p1<shard_id> are required'
            });
        }
        const transactionId = req.query.p0;
        database.firstShardORShardZeroRepository('transaction', req.query.p1, transactionRepository => {
            return transactionRepository.getTransactionObjectFromDB(transactionId)
                                        .then(transaction => ([
                                            transactionRepository.normalizeTransactionObject(transaction),
                                            transactionRepository
                                        ]));
        }).then(([transaction, transactionRepository]) => {
            if (!transaction) {
                peer.transactionSyncRequest(transactionId).catch(_ => _);
                return res.status(404).send();
            }

            if (walletUtils.isValidTransactionObject(transaction)) {
                return res.status(200).send();
            }

            return transactionRepository.deleteTransaction(transactionId)
                                        .then(() => {
                                            return res.status(201).send();
                                        });
        }).catch(e => res.send({
            api_status : 'fail',
            api_message: `unexpected generic api error: (${e})`
        }));
    }

}


export default new _K9wxNE4Ved38xhJm();
