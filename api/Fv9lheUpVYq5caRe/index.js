import wallet from '../../core/wallet/wallet';
import Endpoint from '../endpoint';


/**
 * api reset_transaction_verification_timeout
 */
class _Fv9lheUpVYq5caRe extends Endpoint {
    constructor() {
        super('Fv9lheUpVYq5caRe');
    }

    /**
     * resets is_timeout field in table transaction records belonging to the
     * provided key_identifier from true to false to allow the node to retry
     * transaction validation
     * @param app
     * @param req (p0: key_identifier<required>)
     * @param res
     */
    handler(app, req, res) {
        //TODO: update is_timeout in the database
        if (!req.query.p0) {
            return res.status(400).send({
                status : 'fail',
                message: 'p0<key_identifier> is required'
            });
        }
        wallet.getConsensus().resetTransactionValidationRejected();
        res.send({status: 'success'});
    }
}


export default new _Fv9lheUpVYq5caRe();
