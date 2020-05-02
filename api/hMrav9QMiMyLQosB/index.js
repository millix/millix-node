import database from '../../database/database';
import Endpoint from '../endpoint';


// api new_address_version
class _hMrav9QMiMyLQosB extends Endpoint {
    constructor() {
        super('hMrav9QMiMyLQosB');
    }

    handler(app, req, res) {
        const {p0: version, p1: isMainNetwork, p2: regexPattern, p3: isDefault} = req.query;
        if (!version || isMainNetwork === undefined || !regexPattern || isDefault === undefined) {
            return res.status(400).send({status: 'p0<version>, p1<is_main_network>, p2<regex_pattern> and p3<is_default> are required'});
        }

        const addressRepository = database.getRepository('address');
        addressRepository.addAddressVersion(version, isMainNetwork === 'true', regexPattern, isDefault === 'true')
                         .then(() => res.send({status: 'supported_version_added'}))
                         .catch(() => res.send({status: 'supported_version_not_added'}));
    }
}


export default new _hMrav9QMiMyLQosB();
