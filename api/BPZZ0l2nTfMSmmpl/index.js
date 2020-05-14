import walletUtils from '../../core/wallet/wallet-utils';
import Endpoint from '../endpoint';


/**
 * api get_mnemonic_phrase
 */
class _BPZZ0l2nTfMSmmpl extends Endpoint {
    constructor() {
        super('BPZZ0l2nTfMSmmpl');
    }

    /**
     * returns the 24 word mnemonic phrase for the active session which is
     * stored by default in the millix directory
     * @param app
     * @param req
     * @param res
     */
    handler(app, req, res) {
        walletUtils.loadMnemonic()
                   .then(([mnemonic, _]) => {
                       res.send({mnemonic_phrase: mnemonic});
                   })
                   .catch(e => res.send({success: true}));
    }
}


export default new _BPZZ0l2nTfMSmmpl();
