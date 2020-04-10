import walletUtils from '../../core/wallet/wallet-utils';


// api get_mnemonic
class _BPZZ0l2nTfMSmmpl {
    constructor() {
        this.endpoint = 'BPZZ0l2nTfMSmmpl';
    }

    register(app, apiURL) {
        app.get(apiURL + this.endpoint, (req, res) => {
            walletUtils.loadMnemonic()
                       .then(([mnemonic, _]) => {
                           res.send({mnemonic_phrase: mnemonic});
                       })
                       .catch(e => res.send({error: true}));
        });
    }
}


export default new _BPZZ0l2nTfMSmmpl();
