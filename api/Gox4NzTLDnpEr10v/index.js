import Endpoint from '../endpoint';
import walletUtils from '../../core/wallet/wallet-utils';


/**
 * api get_random_mnemonic
 */
class _Gox4NzTLDnpEr10v extends Endpoint {
    constructor() {
        super('Gox4NzTLDnpEr10v');
    }

    /**
     * returns a random mnemonic phrase
     * @param app
     * @param req
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        res.send({mnemonic: walletUtils.newMnemonic().phrase});
    }
}


export default new _Gox4NzTLDnpEr10v();
