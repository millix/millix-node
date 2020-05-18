import database from '../../database/database';
import Endpoint from '../endpoint';


/**
 * api new_address_version
 */
class _hMrav9QMiMyLQosB extends Endpoint {
    constructor() {
        super('hMrav9QMiMyLQosB');
    }

    /**
     * inserts a new record to table address_version.  is_main_network
     * indicates whether the new address version is on the main network or on a
     * test network.  if the new record indicates is_default = true the
     * previous address_version record set to is_default = true is updated to
     * is_default = false.  there can only be a single record for each network
     * that is set to is_default = true
     * @param app
     * @param req (p0: version<required>, p1: regex_pattern<required>, p2:
     *     is_main_network<required>, p3: is_default<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const {p0: version, p1: isMainNetwork, p2: regexPattern, p3: isDefault} = req.query;
        if (!version || isMainNetwork === undefined || !regexPattern || isDefault === undefined) {
            return res.status(400).send({
                status: 'fail',
                message: 'p0<version>, p1<is_main_network>, p2<regex_pattern> and p3<is_default> are required'
            });
        }

        const addressRepository = database.getRepository('address');
        addressRepository.addAddressVersion(version, !!isMainNetwork, regexPattern, !!isDefault)
                         .then(() => res.send({status: 'success'}))
                         .catch(() => res.send({
                             status : 'fail',
                             message: 'supported_version_not_added'
                         }));
    }
}


export default new _hMrav9QMiMyLQosB();
