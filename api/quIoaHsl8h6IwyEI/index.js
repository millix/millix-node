import database from '../../database/database';
import wallet from '../../core/wallet/wallet';


// api list_keychain_address
class _quIoaHsl8h6IwyEI {
    constructor() {
        this.endpoint = 'quIoaHsl8h6IwyEI';
    }

    register(app, apiURL) {
        const keychainRepository = database.getRepository('keychain');
        app.get(apiURL + this.endpoint, (_, res) => {
            keychainRepository.getWalletAddresses(wallet.getDefaultActiveWallet())
                              .then((addresses) => {
                                  res.send(addresses);
                              });
        });
    }
};

export default new _quIoaHsl8h6IwyEI();
