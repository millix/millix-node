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
            return res.status(400).send({status: 'p0<passphrase> and p1<mnemonic_phrase> are required'});
        }

        walletUtils.storeMnemonic(mnemonicPhrase, true)
                   .then(() => wallet.stop())
                   .then(() => {
                       let authenticationErrorHandler, authenticationSuccessHandler;
                       eventBus.once('wallet_ready', () => {
                           eventBus.emit('wallet_key', passPhrase);
                       });

                       authenticationErrorHandler = () => {
                           res.status(401).send({status: 'wallet_authentication_error'});
                           eventBus.removeListener('wallet_unlock', authenticationSuccessHandler);
                       };
                       eventBus.once('wallet_authentication_error', authenticationErrorHandler);

                       authenticationSuccessHandler = () => {
                           res.send({status: 'wallet_unlock'});
                           eventBus.removeListener('wallet_unlock', authenticationErrorHandler);
                       };
                       eventBus.once('wallet_unlock', authenticationSuccessHandler);

                       wallet.initialize(false)
                             .catch(() => res.send({status: 'wallet_initialize_error'}));
                   });

    }
}


export default new _GktuwZlVP39gty6v();
