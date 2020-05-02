import Endpoint from '../endpoint';
import walletUtils from '../../core/wallet/wallet-utils';
import peer from '../../net/peer';


// api send_transaction
class _VnJIBrrM0KY3uQ9X extends Endpoint {
    constructor() {
        super('VnJIBrrM0KY3uQ9X');
    }

    handler(app, req, res) {
        if (!req.query.p0) {
            return res.status(400).send({status: 'p0<transaction_payload> is required'});
        }

        try {
            const transaction = JSON.parse(req.query.p0);
            walletUtils.verifyTransaction(transaction)
                       .then(valid => {
                           if (!valid) {
                               return res.status(400).send({'status': 'bad_transaction_payload'});
                           }

                           peer.transactionSend(transaction);
                           res.send({status: 'send_transaction_success'});
                       });
        }
        catch (e) {
            return res.send({status: 'send_transaction_error'});
        }
    }
}


export default new _VnJIBrrM0KY3uQ9X();
