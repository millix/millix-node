import database from '../../database/database';
import wallet from '../../core/wallet/wallet';
import Endpoint from '../endpoint';


// api list_keychain_address
class _quIoaHsl8h6IwyEI extends Endpoint {
    constructor() {
        super('quIoaHsl8h6IwyEI');
    }

    handler(app, req, res) {
        const orderBy            = req.query.p3;
        const limit              = parseInt(req.query.p4) || 1000;
        const keychainRepository = database.getRepository('keychain');
        keychainRepository.listWalletAddresses({
            address_key_identifier: req.query.p0,
            wallet_id             : req.query.p1,
            is_change             : req.query.p2
        }, orderBy, limit)
                          .then((addresses) => {
                              res.send(addresses);
                          });
    }
}


export default new _quIoaHsl8h6IwyEI();
