import Endpoint from '../endpoint';
import configLoader from '../../core/config/config-loader';


/**
 * api reload_configs_from_database
 */
class _QgbDSAuy1SYgocs6 extends Endpoint {
    constructor() {
        super('QgbDSAuy1SYgocs6');
    }

    /**
     * reloads configurations from the database
     * @param app
     * @param req
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        configLoader.load(true)
                    .then(() => res.send({api_status: 'success'}))
                    .catch(e => res.send({
                        api_status : 'fail',
                        api_message: `unexpected generic api error: (${e?.message || e.cause || e})`
                    }));
    }
}


export default new _QgbDSAuy1SYgocs6();
