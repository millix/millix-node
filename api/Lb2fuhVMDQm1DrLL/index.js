import wallet from '../../core/wallet/wallet';
import Endpoint from '../endpoint';


// api new_keychain_address
class _Lb2fuhVMDQm1DrLL extends Endpoint {
    constructor() {
        super('Lb2fuhVMDQm1DrLL');
    }

    handler(app, req, res) {
        wallet.addNewAddress(wallet.getDefaultActiveWallet())
              .then(address => {
                  res.send(address);
              });
    }
}

export default new _Lb2fuhVMDQm1DrLL();
