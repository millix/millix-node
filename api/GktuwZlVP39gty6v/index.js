import wallet from '../../core/wallet/wallet';
import Endpoint from '../endpoint';
import fs from 'fs';
import eventBus from '../../core/event-bus';
import walletUtils from '../../core/wallet/wallet-utils';


/**
 * api new_session_with_phrase
 */
class _GktuwZlVP39gty6v extends Endpoint {
    constructor() {
        super('GktuwZlVP39gty6v');
    }

    /**
     * uses the passphrase and 24 word mnemonic phrase to set the active wallet
     * used in the session by the node
     * @param app
     * @param req (p0: passphrase<required>, p1: mnemonic_phrase<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const {p0: passPhrase, p1: mnemonicPhrase} = req.query;
        if (!passPhrase || !(mnemonicPhrase)) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<passphrase> and p1<mnemonic_phrase> are required'
            });
        }

        walletUtils.storeMnemonic(mnemonicPhrase, true)
                   .then(() => wallet.stop())
                   .then(() => {
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
                           res.send({api_status: 'success'});
                           eventBus.removeListener('wallet_unlock', authenticationErrorHandler);
                       };
                       eventBus.once('wallet_unlock', authenticationSuccessHandler);

                       wallet.initialize(false)
                             .catch(e => res.send({
                                 api_status : 'fail',
                                 api_message: `unexpected generic api error: (${e})`
                             }));
                   });

    }
}


export default new _GktuwZlVP39gty6v();
