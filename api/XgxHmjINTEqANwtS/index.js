import database from '../../database/database';
import Endpoint from "../endpoint";

/**
 * api remove_address_version
 */

class _XgxHmjINTEqANwtS extends Endpoint {
    constructor() {
        super('XgxHmjINTEqANwtS');
    }

    /**
     *
     * @param app
     * @param req
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const {p0: version} = req.query;
        if (!version) {
            return res.status(400).send({
                api_status: 'fail',
                api_message: 'p0<version> is required'
            });
        }
        database.getRepository('address')
            .removeAddressVersion(version)
            .then(() => res.send({
                app_status: 'success'
            }))
            .catch(e => res.send({
                api_status: 'fail',
                api_message: `unexpected generic api error: (${e})`
            }));
    }
}

export default new _XgxHmjINTEqANwtS();