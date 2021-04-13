import Endpoint from '../endpoint';
import wallet from '../../core/wallet/wallet';
import database from '../../database/database';
import _ from 'lodash';


/**
 * api get_session
 */
class _OBexeX0f0MsnL1S3 extends Endpoint {
    constructor() {
        super('OBexeX0f0MsnL1S3');
    }

    /**
     * get the active wallet in the node
     * in the node
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

        const walletID = wallet.getDefaultActiveWallet();
        database.getRepository('keychain').getWalletDefaultKeyIdentifier(walletID)
                .then(keyIdentifier => {
                    const addressVersion = database.getRepository('address').getDefaultAddressVersion().version;
                    res.send({
                        api_status: 'success',
                        wallet    : {
                            id     : walletID,
                            address: `${keyIdentifier}${addressVersion}${keyIdentifier}`
                        }
                    });
                });
    }
}


export default new _OBexeX0f0MsnL1S3();
