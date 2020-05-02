import Endpoint from '../endpoint';
import database from '../../database/database';
import walletUtils from '../../core/wallet/wallet-utils';
import wallet from '../../core/wallet/wallet';


// api sign_transaction
class _RVBqKlGdk9aEhi5J extends Endpoint {
    constructor() {
        super('RVBqKlGdk9aEhi5J');
    }

    handler(app, req, res) {
        if (!req.query.p0 || !req.query.p1) {
            return res.status(400).send({status: 'p0<transaction_payload> and p1<private_key_hex> are required'});
        }

        try {
            const transactionPayload = JSON.parse(req.query.p0);
            const privateKeyMap      = JSON.parse(req.query.p1);
            walletUtils.signTransaction(transactionPayload.transaction_input_list, transactionPayload.transaction_output_list, privateKeyMap)
                       .then(signedTransaction => res.send(signedTransaction))
                       .catch(status => res.send({status}));
        }
        catch (e) {
            return res.send({status: 'transaction_sign_error'});
        }
    }
}


export default new _RVBqKlGdk9aEhi5J();
