import database from '../../database/database';
import Endpoint from '../endpoint';


// api get_keychain_address
class _ywTmt3C0nwk5k4c7 extends Endpoint {
    constructor() {
        super('ywTmt3C0nwk5k4c7');
    }

    handler(app, req, res) {
        if (!req.query.p0) {
            return res.status(400).send({error: 'p0<address> is required'});
        }
        const keychainRepository = database.getRepository('keychain');
        keychainRepository.getAddress(req.query.p0)
                          .then(address => {
                              res.send(address);
                          });
    }
}


export default new _ywTmt3C0nwk5k4c7();
