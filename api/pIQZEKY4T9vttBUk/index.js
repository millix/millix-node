import Endpoint from '../endpoint';
import wallet from '../../core/wallet/wallet';
import _ from 'lodash';
import services from '../../core/services/services';


/**
 * api end_session
 */
class _pIQZEKY4T9vttBUk extends Endpoint {
    constructor() {
        super('pIQZEKY4T9vttBUk');
    }

    /**
     * ends the active wallet session in the node
     * @param app
     * @param req
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (!wallet.initialized || _.isEmpty(wallet.getActiveWallets())) {
            return res.send({
                api_status : 'fail',
                api_message: 'wallet not loaded'
            });
        }

        services.stop();
        return res.send({
            address_key_identifier: wallet.defaultKeyIdentifier,
            locked                : true
        });
    }
}


export default new _pIQZEKY4T9vttBUk();
