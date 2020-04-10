import database from '../../database/database';
import async from 'async';

// api update_configuration
class _LLpSTquu4tZL8Nu5 {
    constructor() {
        this.endpoint = 'LLpSTquu4tZL8Nu5';
    }

    register(app, apiURL) {
        const configurationRepository = database.getRepository('config');
        app.post(apiURL + this.endpoint, (req, res) => {
            const data = req.body;
            if (data.configurations) {
                async.eachSeries(data.configurations, (configuration, callback) => {
                    const { config_name: configName, type, value } = configuration;
                    configurationRepository.addConfig(configName, value, type)
                        .then(() => callback())
                        .catch(() => {
                            configurationRepository.updateConfig(configName, value, type)
                                .then(() => callback());
                        });
                }, () => {
                    res.send({ error: false });
                });
            } else {
                res.send({ error: true });
            }
        });
    }
}

export default new _LLpSTquu4tZL8Nu5();
