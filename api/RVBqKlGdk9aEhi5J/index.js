import Endpoint from '../endpoint';
import walletUtils from '../../core/wallet/wallet-utils';


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
            walletUtils.signTransaction(transactionPayload.transaction_input_list, transactionPayload.transaction_output_list, privateKeyMap)
                       .then(signedTransaction => res.send(signedTransaction))
                       .catch(e => res.send({
                           status : 'fail',
                           message: e
                       }));
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
