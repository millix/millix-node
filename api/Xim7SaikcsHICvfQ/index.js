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

    _isValid(addressBase, addressVersion, addressKeyIdentifier) {
        if (!addressBase || !addressVersion || !addressKeyIdentifier) {
            return false;
        }
        else if (addressVersion === this.addressRepository.getDefaultAddressVersion()) {
            return walletUtils.isValidAddress(addressBase) && walletUtils.isValidAddress(addressKeyIdentifier);
        }
        else if (addressVersion.charAt(1) === 'b') { //using public key as address base
            return walletUtils.isValidAddress(addressKeyIdentifier);
        }
        return false;
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
            const {
                      address   : addressBase,
                      identifier: addressKeyIdentifier,
                      version   : addressVersion
                  } = this.addressRepository.getAddressComponent(address);
            res.send({
                is_valid              : this._isValid(addressBase, addressVersion, addressKeyIdentifier),
                address_base          : addressBase,
                address_version       : addressVersion,
                address_key_identifier: addressKeyIdentifier
            });
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
