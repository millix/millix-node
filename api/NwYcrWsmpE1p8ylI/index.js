import wallet from '../../core/wallet/wallet';
import Endpoint from '../endpoint';
import fs from 'fs';
import eventBus from '../../core/event-bus';
import walletUtils from '../../core/wallet/wallet-utils';


/**
 * api new_session_with_file
 */
class _NwYcrWsmpE1p8ylI extends Endpoint {
    constructor() {
        super('NwYcrWsmpE1p8ylI');
    }

    _getMnemonicPhrase(mnemonicFile) {
        return new Promise((resolve, reject) => {
            fs.readFile(mnemonicFile, 'utf8', function(err, data) {
                if (err) {
                    return reject(err);
                }
                try {
                    const keys = JSON.parse(data);
                    if (keys.mnemonic_phrase) {
                        return resolve(keys.mnemonic_phrase);
                    }
                    else {
                        return reject('bad mnemonic file: there is no mnemonic_phrase');
                    }
                }
                catch (e) {
                    return reject(e);
                }
            });
        });
    }

    /**
     * uses the passphrase and file path containing the 24 word mnemonic phrase
     * to set the active wallet used in the session by the node
     * @param app
     * @param req (p0: passphrase<required>, p1: mnemonic_file_path<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const {p0: passPhrase, p1: mnemonicFilePath} = req.query;
        if (!passPhrase || !(mnemonicFilePath)) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<passphrase> and p1<mnemonic_file_path> are required'
            });
        }

        let authenticationErrorHandler, authenticationSuccessHandler;
        this._getMnemonicPhrase(mnemonicFilePath)
            .then(mnemonicPhrase => {
                return walletUtils.storeMnemonic(mnemonicPhrase, true)
                                  .then(() => wallet.stop())
                                  .then(() => {
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
                                          eventBus.removeListener('wallet_authentication_error', authenticationErrorHandler);
                                      };
                                      eventBus.once('wallet_unlock', authenticationSuccessHandler);

                                      return wallet.initialize(false);
                                  });
            })
            .catch((e) => {
                authenticationErrorHandler && eventBus.removeListener('wallet_authentication_error', authenticationErrorHandler);
                authenticationSuccessHandler && eventBus.removeListener('wallet_unlock', authenticationSuccessHandler);
                res.send({
                    api_status : 'fail',
                    api_message: `unexpected generic api error: (${e})`
                });
            });
    }
}


export default new _NwYcrWsmpE1p8ylI();
