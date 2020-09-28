import database from '../../database/database';
import Endpoint from '../endpoint';


/**
 * api list_keychain_address
 */
class _quIoaHsl8h6IwyEI extends Endpoint {
    constructor() {
        super('quIoaHsl8h6IwyEI');
    }

    /**
     * returns records from table keychain_address. it returns the newest
     * records by default.
     * @param app
     * @param req (p0: address_key_identifier, p1: wallet_id, p2: is_change,
     *     p3: order_by="create_date desc", p4: record_limit:1000)
     * @param res
     */
    handler(app, req, res) {
        const orderBy            = req.query.p3 || 'create_date desc';
        const limit              = parseInt(req.query.p4) || 1000;
        const keychainRepository = database.getRepository('keychain');
        keychainRepository.listWalletAddresses({
            address_key_identifier: req.query.p0,
            wallet_id             : req.query.p1,
            is_change             : req.query.p2
        }, orderBy, limit)
                          .then((addresses) => {
                              res.send(addresses);
                          })
                          .catch(e => res.send({
                              api_status : 'fail',
                              api_message: `unexpected generic api error: (${e})`
                          }));
    }
}


export default new _quIoaHsl8h6IwyEI();
