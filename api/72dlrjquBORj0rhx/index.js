import database from '../../database/database';
import Endpoint from '../endpoint';


// api list_address
class _72dlrjquBORj0rhx extends Endpoint {
    constructor() {
        super('72dlrjquBORj0rhx');
    }

    handler(app, req, res) {
        const addressRepository = database.getRepository('address');
        addressRepository.getAllAddress()
                         .then(addresses => res.send(addresses));
    }
}


export default new _72dlrjquBORj0rhx();
