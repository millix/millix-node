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
        if (req.method === 'POST') {
            if (!req.body.p0 || !req.body.p1) {
                return res.status(400)
                    .send({
                        api_status: 'fail',
                        api_message: `p0<config_id> and p1<config_value> are rquired`
                    })
            }

            let configID = req.body.p0;
            let value = req.body.p1;
            const configurationRepository = database.getRepository('config');
            if (typeof value === 'object') {
                value = JSON.stringify(value);
            }

            configurationRepository.updateConfigByID(configID, value)
                .then((row) => res.send({
                    api_status: 'success',
                    row: row
                }))
                .catch(e => res.send({
                    api_status: 'fail',
                    api_message: `unexpected generic api error: (${e})`
                }));

        } else {
            return res.status(400)
                .send({
                    api_status: 'fail',
                    api_message: 'POST only'
                })
        }
    }
}


export default new _LLpSTquu4tZL8Nu5();
