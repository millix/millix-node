import wallet from '../../core/wallet/wallet';


// api new_keychain_address
class _Lb2fuhVMDQm1DrLL {
    constructor() {
        this.endpoint = 'Lb2fuhVMDQm1DrLL';
    }

    register(app, apiURL) {
        app.post(apiURL + this.endpoint, (_, res) => {
            wallet.addNewAddress(wallet.getDefaultActiveWallet())
                  .then(address => {
                      res.send(address);
                  });
        });
    }
};

export default new _Lb2fuhVMDQm1DrLL();
