import wallet from '../../core/wallet/wallet';
import Endpoint from '../endpoint';


/**
 * api new_keychain_address
 */
class _Lb2fuhVMDQm1DrLL extends Endpoint {
    constructor() {
        super('Lb2fuhVMDQm1DrLL');
    }

    /**
     * generates a new address and returns the new address record from table
     * address
     * @param app
     * @param req
     * @param res
     */
    handler(app, req, res) {
        wallet.addNewAddress(wallet.getDefaultActiveWallet())
              .then(address => {
                  res.send(address);
              })
              .catch(e => res.send({
                  api_status : 'fail',
                  api_message: `unexpected generic api error: (${e})`
              }));
    }
}


export default new _Lb2fuhVMDQm1DrLL();
