import Endpoint from '../endpoint';
import wallet from '../../core/wallet/wallet';


/**
 * api wallet_stop_ongoing_transaction
 */
class _RIlwZyfnizp2i8wh extends Endpoint {
    constructor() {
        super('RIlwZyfnizp2i8wh');
    }

    /**
     * stops current ongoing transaction if any.
     * @param app
     * @param req
     * @param res
     */
    handler(app, req, res) {
        wallet.interruptTransactionSendInProgress();
        res.send({success: true});
    }
}


export default new _RIlwZyfnizp2i8wh();
