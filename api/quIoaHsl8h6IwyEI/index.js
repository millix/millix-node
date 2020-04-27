import database from '../../database/database';
import wallet from '../../core/wallet/wallet';
import Endpoint from '../endpoint';


// api list_keychain_address
class _quIoaHsl8h6IwyEI extends Endpoint {
    constructor() {
        super('quIoaHsl8h6IwyEI');
    }

    handler(app, req, res) {
        const keychainRepository = database.getRepository('keychain');
        keychainRepository.getWalletAddresses(wallet.getDefaultActiveWallet())
                          .then((addresses) => {
                              res.send(addresses);
                          });
    }
}

export default new _quIoaHsl8h6IwyEI();
