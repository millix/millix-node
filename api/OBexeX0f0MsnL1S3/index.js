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
     * gets the active wallet in the node
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

        const walletID      = wallet.getDefaultActiveWallet();
        const keyIdentifier = wallet.defaultKeyIdentifier;
        database.getRepository('address').getAddressBaseAttribute(keyIdentifier, 'key_public')
                .then(publicKey => {
                    const addressVersion = database.getRepository('address').getDefaultAddressVersion().version;
                    res.send({
                        api_status: 'success',
                        wallet    : {
                            id                    : walletID,
                            address               : `${keyIdentifier}${addressVersion}${keyIdentifier}`,
                            address_key_identifier: keyIdentifier,
                            address_public_key    : publicKey
                        }
                    });
                });
    }
}


export default new _OBexeX0f0MsnL1S3();
