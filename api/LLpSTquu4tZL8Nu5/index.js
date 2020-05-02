import database from '../../database/database';
import async from 'async';
import Endpoint from '../endpoint';


// api update_configuration
class _LLpSTquu4tZL8Nu5 extends Endpoint {
    constructor() {
        super('LLpSTquu4tZL8Nu5');
    }

    handler(app, req, res) {
        const {p0: configName, p1: type, p2: value} = req.query;
        if (!configName || !type || value === undefined) {
            return res.status(400).send({status: 'p0<config_name>, p1<type> and p2<value> are required'});
        }

        const configurationRepository = database.getRepository('config');
        configurationRepository.addConfig(configName, value, type)
                               .then(() => res.send({status: 'config_added'}))
                               .catch(() => {
                                   configurationRepository.updateConfig(configName, value, type)
                                                          .then(() => res.send({status: 'config_updated'}))
                                                          .catch(() => {
                                                              res.send({status: 'error_add_config'});
                                                          });
                               });
    }
}


export default new _LLpSTquu4tZL8Nu5();
