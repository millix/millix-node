import Endpoint from '../endpoint';
import database from '../../database/database';
import walletUtils from '../../core/wallet/wallet-utils';
import wallet from '../../core/wallet/wallet';


/**
 * api get_address_private_key
 */
class _PKUv2JfV87KpEZwE extends Endpoint {
    constructor() {
        super('PKUv2JfV87KpEZwE');
    }

    /**
     * returns the private key for the indicated address that is derived from the master key that is temporarily stored in node memory for the active wallet
     * @param app
     * @param req (p0: address_base<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (!req.query.p0) {
            return res.status(400).send({status: 'p0<address_base> is required'});
        }
        else if (!wallet.initialized) {
            return res.status(401).send({status: 'wallet_not_initialized'});
        }

        const keychainRepository = database.getRepository('keychain');
        keychainRepository.getAddress(req.query.p0)
                          .then(address => {
                              const walletID           = address.wallet_id;
                              const extendedPrivateKey = wallet.getActiveWallets()[walletID];
                              if (!extendedPrivateKey) {
                                  return res.status(401).send({status: 'wallet_not_active'});
                              }

                              const privateKey = walletUtils.derivePrivateKey(extendedPrivateKey, address.is_change, address.address_position);
                              res.send({private_key_hex: privateKey.toString('hex')});
                          })
                          .catch(() => res.send({status: 'address_not_found'}));
    }
}


export default new _PKUv2JfV87KpEZwE();
