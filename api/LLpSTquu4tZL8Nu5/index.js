import database from '../../database/database';
import Endpoint from '../endpoint';


/**
 * api update_config_value
 */
class _LLpSTquu4tZL8Nu5 extends Endpoint {
    constructor() {
        super('LLpSTquu4tZL8Nu5');
    }

    /**
     * updates table config value field for the indicated config_id record
     * @param app
     * @param req (p0: config_id<required>, p1:value<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const {p0: configID, p1: value} = req.query;
        if (!configID || value === undefined) {
            return res.status(400).send({status: 'p0<config_id> and p1<value> are required'});
        }

        const configurationRepository = database.getRepository('config');
        configurationRepository.updateConfigByID(configID, value)
                               .then(() => res.send({status: 'success'}))
                               .catch(() => {
                                   res.send({status: 'fail'});
                               });
    }
}


export default new _LLpSTquu4tZL8Nu5();
