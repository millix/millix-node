import Endpoint from '../endpoint';
import walletUtils from '../../core/wallet/wallet-utils';
import ntp from '../../core/ntp';
import config from '../../core/config/config';


/**
 * api sign_transaction
 */

class _RVBqKlGdk9aEhi5J extends Endpoint {
    constructor() {
        super('RVBqKlGdk9aEhi5J');
    }

    /**
     * accepts an unsigned transaction payload and private keys to produce a
     * signed version of the transaction_payload_unsigned that is used by API
     * VnJIBrrM0KY3uQ9X to send a transaction
     * @param app
     * @param req (p0: transaction_payload_unsigned<required>, p1:
     *     private_key_hex<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (!req.query.p0 || !req.query.p1) {
            return res.status(400).send({
                status : 'fail',
                message: 'p0<transaction_payload_unsigned> and p1<private_key_hex> are required'
            });
        }

        try {
            const transactionPayload = JSON.parse(req.query.p0);
            const privateKeyMap      = JSON.parse(req.query.p1);

            ntp.getTime().then(time => {
                const transactionDate    = new Date(Math.floor(time.now.getTime() / 1000) * 1000);
                const transactionVersion = transactionPayload.transaction_version;
                const transactionInputs  = transactionPayload.transaction_input_list;
                const transactionOutputs = transactionPayload.transaction_output_list;

                new Promise((resolve) => {
                    if (transactionVersion === config.WALLET_TRANSACTION_REFRESH_VERSION) {
                        if (!(walletUtils.isValidRefreshTransaction(transactionInputs, transactionOutputs))) {
                            console.log('[API] Received invalid refresh transaction. Not going to sign.');

                            res.send({
                                status : 'fail',
                                message: 'Invalid refresh transaction'
                            });
                            resolve(false);
                        }
                        else {
                            resolve(true);
                        }
                    }
                    else {
                        walletUtils.isConsumingExpiredOutputs(transactionInputs, transactionDate)
                                   .then(isConsuming => {
                                       if (isConsuming) {
                                           console.log('[API] Transaction consuming expired transaction outputs. Not going to sign.');

                                           res.send({
                                               status : 'fail',
                                               message: 'Consuming transactions that have expired'
                                           });
                                       }
                                       resolve(!isConsuming);
                                   });
                    }
                })
                    .then(shouldSign => {
                        if (shouldSign) {
                            walletUtils.signTransaction(transactionInputs, transactionOutputs, privateKeyMap, transactionDate, transactionVersion)
                                       .then(signedTransaction => {
                                           console.log('[API] Successfully signed transaction transaction.');
                                           res.send(signedTransaction);
                                       })
                                       .catch(e => {
                                           console.log(`[API] Failed to sign transaction. Error: ${e}`);
                                           res.send({
                                               status : 'fail',
                                               message: e.message
                                           });
                                       });
                        }
                    });
            });
        }
        catch (e) {
            return res.send({
                status : 'fail',
                message: 'transaction_sign_error'
            });
        }
    }
}


export default new _RVBqKlGdk9aEhi5J();
