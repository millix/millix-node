import Endpoint from '../endpoint';
import walletUtils from '../../core/wallet/wallet-utils';
import database from '../../database/database';


/**
 * api verify_address
 */
class _Xim7SaikcsHICvfQ extends Endpoint {
    constructor() {
        super('Xim7SaikcsHICvfQ');
        this.addressRepository = database.getRepository('address');
    }

    /**
     * returns verifies if an address is valid
     * @param app
     * @param req (p0: address<required>)
     * @param res
     */
    handler(app, req, res) {
        const address = req.query.p0;
        if (!address) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<address> is required'
            });
        }
        try {
            const {address: addressBase, identifier: addressKeyIdentifier} = this.addressRepository.getAddressComponent(address);
            res.send({is_valid: walletUtils.isValidAddress(addressBase) && walletUtils.isValidAddress(addressKeyIdentifier)});
        }
        catch (e) {
            res.send({
                api_status : 'fail',
                api_message: `unexpected generic api error: (${e})`
            });
        }
    }
}


export default new _Xim7SaikcsHICvfQ();
