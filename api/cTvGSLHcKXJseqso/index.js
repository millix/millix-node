import Endpoint from '../endpoint';
import walletTransactionConsensus from '../../core/wallet/wallet-transaction-consensus';


/**
 * api invalidate_transaction
 */
class _cTvGSLHcKXJseqso extends Endpoint {
    constructor() {
        super('cTvGSLHcKXJseqso');
    }

    /**
     * marks a transaction invalid on this node, as the consensus does when it
     * finds a transaction invalid: frees the outputs it spent and sends the
     * transactions spending its outputs back to validation
     * @param app
     * @param req (p0: transaction_id)
     * @param res
     */
    handler(app, req, res) {
        const transactionID = req.method === 'POST' ? req.body?.p0 : req.query.p0;
        if (typeof transactionID !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{1,50}$/.test(transactionID)) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<transaction_id> is required'
            });
        }

        walletTransactionConsensus.invalidateTransaction(transactionID)
                                  .then(() => res.send({
                                      api_status    : 'success',
                                      transaction_id: transactionID
                                  }))
                                  .catch(e => {
                                      if (e === 'transaction_not_found') {
                                          return res.status(404).send({
                                              api_status : 'fail',
                                              api_message: 'transaction_not_found'
                                          });
                                      }
                                      res.send({
                                          api_status : 'fail',
                                          api_message: `unexpected generic api error: (${e})`
                                      });
                                  });
    }
}


export default new _cTvGSLHcKXJseqso();
