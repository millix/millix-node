import Endpoint from '../endpoint';
import walletUtils from '../../core/wallet/wallet-utils';
import services from '../../core/services/services';
import eventBus from '../../core/event-bus';
import wallet from '../../core/wallet/wallet';
import database from '../../database/database';


/**
 * api new_session
 */
class _PMW9LXqUv7vXLpbA extends Endpoint {
    constructor() {
        super('PMW9LXqUv7vXLpbA');
    }

    /**
     * uses the passphrase to activate the wallet used in the previous session
     * in the node
     * @param app
     * @param req (p0: passphrase<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const {p0: passPhrase} = req.query;
        if (!passPhrase) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<passphrase> are required'
            });
        }

        let authenticationErrorHandler, authenticationSuccessHandler;
        eventBus.once('wallet_ready', () => {
            eventBus.emit('wallet_key', passPhrase);
        });

        authenticationErrorHandler = () => {
            res.status(401).send({
                api_status : 'fail',
                api_message: 'wallet authentication error'
            });
            eventBus.removeListener('wallet_unlock', authenticationSuccessHandler);
        };
        eventBus.once('wallet_authentication_error', authenticationErrorHandler);

        authenticationSuccessHandler = () => {
            const walletID = wallet.getDefaultActiveWallet();
            database.getRepository('keychain').getWalletDefaultKeyIdentifier(walletID)
                    .then(keyIdentifier => {
                        const addressVersion = database.getRepository('address').getDefaultAddressVersion().version;
                        res.send({
                            api_status: 'success',
                            wallet    : {
                                id                    : walletID,
                                address               : `${keyIdentifier}${addressVersion}${keyIdentifier}`,
                                address_key_identifier: keyIdentifier
                            }
                        });
                    });
            eventBus.removeListener('wallet_authentication_error', authenticationErrorHandler);
        };
        eventBus.once('wallet_unlock', authenticationSuccessHandler);
        services.stop();
        services.initialize({
            initialize_wallet_event: false,
            auto_create_wallet     : false
        }).catch(e => {
            eventBus.removeListener('wallet_authentication_error', authenticationErrorHandler);
            eventBus.removeListener('wallet_unlock', authenticationSuccessHandler);
            res.send({
                api_status : 'fail',
                api_message: `unexpected generic api error: (${e})`
            });
        });

    }
}


export default new _PMW9LXqUv7vXLpbA();
