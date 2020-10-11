import Endpoint from '../endpoint';
import walletUtils from '../../core/wallet/wallet-utils';
import peer from '../../net/peer';
import database from '../../database/database';
import mutex from '../../core/mutex';


/**
 * api send_transaction
 */
class _VnJIBrrM0KY3uQ9X extends Endpoint {
    constructor() {
        super('VnJIBrrM0KY3uQ9X');
    }

    /**
     * submits a new transaction with a transaction payload, containing inputs,
     * signatures, outputs and amounts to the node. this API is generally used
     * in conjunction with the output from API RVBqKlGdk9aEhi5J
     * (sign_transaction)
     * @param app
     * @param req (p0: transaction_payload_signed<require>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        let transaction;

        if (req.method === 'GET') {
            if (!req.query.p0) {
                return res.status(400).send({
                    api_status : 'fail',
                    api_message: 'p0<transaction_payload_signed> is required'
                });
            }
            else {
                transaction = JSON.parse(req.query.p0);
            }
        }
        else {
            if (!req.body.p0) {
                return res.status(400).send({
                    api_status : 'fail',
                    api_message: 'p0<transaction_payload_signed> is required'
                });
            }
            else {
                transaction = req.body.p0;
            }
        }


        try {
            mutex.lock(['submit_transaction'], (unlock) => {
                walletUtils.verifyTransaction(transaction)
                           .then(valid => {
                               if (!valid) {
                                   return Promise.reject('bad transaction payload');
                               }

                               console.log(`[api ${this.endpoint}] Storing transaction submitted on API. Hash: ${transaction.transaction_id}`);

                               return database.getRepository('transaction')
                                              .addTransactionFromObject(transaction)
                                              .then(transaction => {
                                                  console.log(`[api ${this.endpoint}] successfully stored transaction submitted on API. Hash: ${transaction.transaction_id}. Submitting to peers`);
                                                  peer.transactionSend(transaction);
                                                  res.send({api_status: 'success'});
                                                  unlock();
                                              });
                           })
                           .catch(e => {
                               console.log(`[api ${this.endpoint}] error: ${e}`);
                               res.send({
                                   api_status : 'fail',
                                   api_message: `unexpected generic api error: (${e})`
                               });
                               unlock();
                           });
            });
        }
        catch (e) {
            console.log(`[api ${this.endpoint}] error: ${e}`);
            return res.send({
                api_status : 'fail',
                api_message: `unexpected generic api error: (${e})`
            });
        }
    }
}


export default new _VnJIBrrM0KY3uQ9X();
