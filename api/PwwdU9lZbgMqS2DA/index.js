import wallet from '../../core/wallet/wallet';
import walletUtils from '../../core/wallet/wallet-utils';
import _ from 'lodash';
import jwt from 'jsonwebtoken';
import Mnemonic from 'bitcore-mnemonic';
import Endpoint from '../endpoint';


// api get_authentication_token
class _PwwdU9lZbgMqS2DA extends Endpoint {
    constructor() {
        super('PwwdU9lZbgMqS2DA');
    }

    handler(app, req, res) {
        const walletID = _.first(Object.keys(wallet.getActiveWallets()));
        wallet.getMnemonic()
              .then(([mnemonic_phrase, isNewMnemonic]) => {
                  if (isNewMnemonic === true) {
                      res.send(401, 'wallet not initialized');
                      return;
                  }

                  const mnemonic       = new Mnemonic(mnemonic_phrase);
                  const masterKey      = mnemonic.toHDPrivateKey(req.query.p0);
                  const account        = 0;
                  const xPrivKey       = walletUtils.deriveExtendedPrivateKey(masterKey, account);
                  const verifyWalletID = walletUtils.deriveWalletFromKey(xPrivKey);
                  if (walletID !== verifyWalletID) {
                      res.send(401, 'wrong authentication');
                      return;
                  }
                  let exp = Math.floor(Date.now() / 1000) + Math.round(req.query.p1);
                  exp = isNaN(exp) ? {} : {exp};
                  const token = jwt.sign({
                      wallet: walletID,
                      ...exp
                  }, app.secret);
                  res.send(token);
              });
    }
}


export default new _PwwdU9lZbgMqS2DA();
