import database from '../../database/database';
import Endpoint from '../endpoint';


// api new_address_version
class _hMrav9QMiMyLQosB extends Endpoint {
    constructor() {
        super('hMrav9QMiMyLQosB');
    }

    handler(app, req, res) {
        const addressRepository = database.getRepository('address');
        let data;
        try {
            data = JSON.parse(req.query.p1);
        }
        catch (e) {
            return res.status(400).send({
                success: false,
                message: 'address payload is missing or invalid'
            });
        }

        if (data) {
            addressRepository.addAddressVersion(data.version, data.is_main_network, data.regex_pattern, data.is_default)
                             .then(() => res.send({success: true}));
        }
        else {
            res.send({success: false});
        }
    }
};

export default new _hMrav9QMiMyLQosB();
