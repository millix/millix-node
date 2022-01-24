import Endpoint from "../endpoint";
import WalletUtils from '../../core/wallet/wallet-utils'

/**
 * api get_is_key_present
 */
class _LOLb7q23p8rYSLwv extends Endpoint {
    constructor() {
        super('LOLb7q23p8rYSLwv');
    }

    handler(app, req, res) {
        WalletUtils.loadMnemonic().then(() => {
            return res.send({
                isKeyPresent: true
            })
        })
            .catch(e => res.send({
                api_status: 'fail',
                api_message: `unexpected generic api error: (${e})`
            }))
    }
}

export default new _LOLb7q23p8rYSLwv();
