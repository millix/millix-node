import walletUtils from '../../core/wallet/wallet-utils';
import Endpoint from '../endpoint';


// api get_mnemonic
class _BPZZ0l2nTfMSmmpl extends Endpoint{
    constructor() {
        super('BPZZ0l2nTfMSmmpl');
    }

    handler(app, req, res) {
        walletUtils.loadMnemonic()
                   .then(([mnemonic, _]) => {
                       res.send({mnemonic_phrase: mnemonic});
                   })
                   .catch(e => res.send({success: true}));
    }
}


export default new _BPZZ0l2nTfMSmmpl();
