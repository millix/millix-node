import network from '../../net/network';


// api new_peer
class _DuOnf1Wqi29oJUaA {
    constructor() {
        this.endpoint = 'DuOnf1Wqi29oJUaA';
    }

    register(app, apiURL) {
        app.post(apiURL + this.endpoint, (req, res) => {
            let data = req.body;
            if (data) {
                network.addNode(data.node_prefix, data.node_ip_address, data.node_port);
                res.send({error: false});
            }
            else {
                res.send({error: true});
            }
        });
    }
};

export default new _DuOnf1Wqi29oJUaA();
