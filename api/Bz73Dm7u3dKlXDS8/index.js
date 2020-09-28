import database from '../../database/database';
import Endpoint from '../endpoint';


/**
 * api get_node_address_stat_summary
 */
class _Bz73Dm7u3dKlXDS8 extends Endpoint {
    constructor() {
        super('Bz73Dm7u3dKlXDS8');
    }

    /**
     * returns returns a summary of address statistics from the host
     * @param app
     * @param req
     * @param res
     */
    handler(app, req, res) {
        const addressRepository = database.getRepository('address');
        addressRepository.getAddressesCount()
                         .then(data => res.send({
                             address_count       : data.address_count,
                             key_identifier_count: data.address_key_identifier_count
                         }))
                         .catch(e => res.send({
                             api_status : 'fail',
                             api_message: `unexpected generic api error: (${e})`
                         }));
    }
};

export default new _Bz73Dm7u3dKlXDS8();
