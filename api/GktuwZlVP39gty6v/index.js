import wallet from '../../core/wallet/wallet';
import Endpoint from '../endpoint';
import fs from 'fs';
import eventBus from '../../core/event-bus';
import walletUtils from '../../core/wallet/wallet-utils';


// api new_session
class _GktuwZlVP39gty6v extends Endpoint {
    constructor() {
        super('GktuwZlVP39gty6v');
    }

    _getMnemonicPhrase(mnemonicPhrase, mnemonicFile) {
        if (mnemonicPhrase) {
            return Promise.resolve(mnemonicPhrase);
        }
        else {
            return new Promise((resolve, reject) => {
                fs.readFile(mnemonicFile, 'utf8', function(err, data) {
                    if (err) {
                        return reject();
                    }
                    try {
                        const keys = JSON.parse(data);
                        if (keys.mnemonic_phrase) {
                            return resolve(keys.mnemonic_phrase);
                        }
                        else {
                            return reject();
                        }
                    }
                    catch (e) {
                        return reject();
                    }
                });
            });
        }
    }

    handler(app, req, res) {
        const {p0: passPhrase, p1: mnemonicPhrase, p2: mnemonicFile} = req.query;
        if (!passPhrase || !(mnemonicPhrase || mnemonicFile)) {
            return res.status(400).send({status: 'p0<config_name>, p1<type> and p2<value> are required'});
        }

        this._getMnemonicPhrase(mnemonicPhrase, mnemonicFile)
            .then(mnemonic => {
                walletUtils.storeMnemonic(mnemonic, true)
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
            })
            .catch(() => res.status(400).send({status: 'wallet_bad_mnemonic'}));

    }
}


export default new _GktuwZlVP39gty6v();
