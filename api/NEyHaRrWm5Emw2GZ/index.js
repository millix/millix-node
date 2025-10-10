import database from '../../database/database';
import Endpoint from '../endpoint';


/**
 * api get_config
 */
class _NEyHaRrWm5Emw2GZ extends Endpoint {
    constructor() {
        super('NEyHaRrWm5Emw2GZ');
    }

    /**
     * gets a config record
     * @param app
     * @param req (p0: config_id<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (!req.query.p0) {
            return res.status(400)
                      .send({
                          api_status : 'fail',
                          api_message: `p0<config_id> is required`
                      });
        }

        const configID                = req.query.p0;
        const configurationRepository = database.getRepository('config');
        configurationRepository.get({config_id: configID})
                               .then(configuration => res.send(configuration))
                               .catch(e => res.send({
                                   api_status : 'fail',
                                   api_message: `unexpected generic api error: (${e})`
                               }));
    }
}


export default new _NEyHaRrWm5Emw2GZ();
