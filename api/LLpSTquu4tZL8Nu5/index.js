import database from '../../database/database';
import async from 'async';
import Endpoint from '../endpoint';


// api update_configuration
class _LLpSTquu4tZL8Nu5 extends Endpoint {
    constructor() {
        super('LLpSTquu4tZL8Nu5');
    }

    handler(app, req, res) {
        const configurationRepository = database.getRepository('config');
        let data;
        try {
            data = JSON.parse(req.query.p1);
        }
        catch (e) {
            return res.status(400).send({
                success: false,
                message: 'config payload is missing or invalid'
            });
        }

        if (data) {
            async.eachSeries(data, (configuration, callback) => {
                const {config_name: configName, type, value} = configuration;
                configurationRepository.addConfig(configName, value, type)
                                       .then(() => callback())
                                       .catch(() => {
                                           configurationRepository.updateConfig(configName, value, type)
                                                                  .then(() => callback());
                                       });
            }, () => {
                res.send({success: true});
            });
        }
        else {
            res.send({success: false});
        }
    }
}


export default new _LLpSTquu4tZL8Nu5();
