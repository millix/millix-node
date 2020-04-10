import network from '../../net/network';
import services from '../../core/serices/services';


// api update_node
class _yefPsK2TvkZmC6M4 {
    constructor() {
        this.endpoint = 'yefPsK2TvkZmC6M4';
    }

    register(app, apiURL) {
        app.put(apiURL + this.endpoint, (req, res) => {
            const data = req.body;
            if (data.run && !services.initialized) {
                services.initialize();
                res.send({error: false});
            }
            else if (!data.run && services.initialized) {
                services.stop();
                res.send({error: false});
            }
            else {
                res.send({error: true});
            }
        });
    }
}


export default new _yefPsK2TvkZmC6M4();
