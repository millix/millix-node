import database from '../../database/database';
import Endpoint from '../endpoint';


// api list_address_version
class _3XqkzNFzaTk1JPRf extends Endpoint {
    constructor() {
        super('3XqkzNFzaTk1JPRf');
    }

    handler(app, req, res) {
        const addressRepository = database.getRepository('address');
        res.send(addressRepository.addressVersionList);
    }
};

export default new _3XqkzNFzaTk1JPRf();
