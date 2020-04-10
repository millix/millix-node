import wallet from '../../core/wallet/wallet';
import walletUtils from '../../core/wallet/wallet-utils';
import _ from 'lodash';
import jwt from 'jsonwebtoken';
import Mnemonic from 'bitcore-mnemonic';


// api get_authentication_token
class _PwwdU9lZbgMqS2DA {
    constructor() {
        this.endpoint = 'PwwdU9lZbgMqS2DA';
    }

    register(app, apiURL) {
        const walletID = _.first(Object.keys(wallet.getActiveWallets()));
        app.post(apiURL + this.endpoint, (req, res) => {
            let data = req.body;
            wallet.getMnemonic()
                  .then(([mnemonic_phrase, isNewMnemonic]) => {
                      if (isNewMnemonic === true) {
                          res.send(401, 'Wallet not initialized');
                          return;
                      }

                      const mnemonic       = new Mnemonic(mnemonic_phrase);
                      const masterKey      = mnemonic.toHDPrivateKey(data.passphrase);
                      const account        = 0;
                      const xPrivKey       = walletUtils.deriveExtendedPrivateKey(masterKey, account);
                      const verifyWalletID = walletUtils.deriveWalletFromKey(xPrivKey);
                      if (walletID !== verifyWalletID) {
                          res.send(401, 'Wrong authentication');
                          return;
                      }

                      const token = jwt.sign({wallet: walletID}, app.secret);
                      res.send(token);
                  });
        });
    }
};

export default new _PwwdU9lZbgMqS2DA();
