import database from '../../database/database';
import Endpoint from '../endpoint';


/**
 * api upsert_config
 */
class _AXVeQ29Zcz5gVxKJ extends Endpoint {
    constructor() {
        super('AXVeQ29Zcz5gVxKJ');
    }

    /**
     * inserts or updates a config record
     * @param app
     * @param req (p0: config_id<required>, p1: config_name<required>, p2:
     *     value<required>
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (req.method === 'POST') {
            if (!req.body.p0 || !req.body.p1 || req.body.p2 === undefined) {
                return res.status(400)
                          .send({
                              api_status : 'fail',
                              api_message: `p0<config_id>, p1<config_name>, and p2<value> are required`
                          });
            }

            const configID   = req.body.p0;
            const configName = req.body.p1;
            let value        = req.body.p2;

            const configurationRepository = database.getRepository('config');

            let type = typeof value;
            if (type !== 'string') {
                value = JSON.stringify(value);
            }

            configurationRepository.upsertConfig(configID, configName, value, type)
                                   .then((row) => res.send({
                                       api_status: 'success',
                                       row       : row
                                   }))
                                   .catch(e => res.send({
                                       api_status : 'fail',
                                       api_message: `unexpected generic api error: (${e})`
                                   }));

        }
        else {
            return res.status(400)
                      .send({
                          api_status : 'fail',
                          api_message: 'POST only'
                      });
        }
    }
}


export default new _AXVeQ29Zcz5gVxKJ();
