import database from '../../database/database';
import Endpoint from '../endpoint';


/**
 * api list_address_version
 */
class _3XqkzNFzaTk1JPRf extends Endpoint {
    constructor() {
        super('3XqkzNFzaTk1JPRf');
    }

    /**
     * return records from table address_version
     * @param app
     * @param req
     * @param res
     */
    handler(app, req, res) {
        const addressRepository = database.getRepository('address');
        addressRepository.listAddressVersion()
                         .then(addressVersionList => res.send(addressVersionList))
                         .catch(() => res.send({status: 'error_list_supported_address_version'}));
    }
};

export default new _3XqkzNFzaTk1JPRf();
