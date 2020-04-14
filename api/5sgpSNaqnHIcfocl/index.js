import network from '../../net/network';


// api update_network_state
class _5sgpSNaqnHIcfocl {
    constructor() {
        this.endpoint = '5sgpSNaqnHIcfocl';
    }

    register(app, apiURL) {
        app.put(apiURL + this.endpoint, (req, res) => {
            const data = req.body;
            if (data.online && network.initialized === false) {
                network.initialize();
                res.send({error: false});
            }
            else if (!data.online && network.initialized === true) {
                network.stop();
                res.send({error: false});
            }
            else {
                res.send({error: true});
            }
        });
    }
}


export default new _5sgpSNaqnHIcfocl();
