import database from '../../database/database';


// api new_address_version
class _hMrav9QMiMyLQosB {
    constructor() {
        this.endpoint = 'hMrav9QMiMyLQosB';
    }

    register(app, apiURL) {
        const addressRepository = database.getRepository('address');
        app.post(apiURL + this.endpoint, (req, res) => {
            let data = req.body;
            if (data) {
                addressRepository.addAddressVersion(data.version, data.is_main_network, data.regex_pattern, data.is_default)
                                 .then(() => res.send({error: false}));
            }
            else {
                res.send({error: true});
            }
        });
    }
};

export default new _hMrav9QMiMyLQosB();
