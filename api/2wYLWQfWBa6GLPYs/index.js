import database from '../../database/database';
import Endpoint from '../endpoint';

/**
 * api get_config_by_name
 */
class _2wYLWQfWBa6GLPYs extends Endpoint {
    constructor() {
        super('2wYLWQfWBa6GLPYs');
    }

    /**
     * get config value by name
     * @param app
     * @param req
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {

        const {p0: configName} = req.query;
        if (!configName) {
            return res.status(400).send({
                api_status: 'fail',
                api_message: 'p0<config_name> is required'
            });
        }
        const configurationRepository = database.getRepository('config');
        configurationRepository.getConfig(configName.toLowerCase())
            .then(configuration => res.send(configuration))
            .catch(e => res.send({
                api_status: 'fail',
                api_message: `unexpected generic api error: (${e})`
            }));
    }
}


export default new _2wYLWQfWBa6GLPYs();