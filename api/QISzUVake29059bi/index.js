import walletUtils from '../../core/wallet/wallet-utils';
import Endpoint from '../endpoint';
import database from '../../database/database';
import server from '../server';
import wallet from '../../core/wallet/wallet';


/**
 * api reset_transaction_validation
 */
class _QISzUVake29059bi extends Endpoint {
    constructor() {
        super('QISzUVake29059bi');
    }

    /**
     * this API resets transaction validation status
     * @param app
     * @param req
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        wallet.resetValidationOnLeafTransactions();
        res.send({success: true});
    }
}


export default new _QISzUVake29059bi();
