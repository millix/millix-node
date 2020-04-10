import database from '../../database/database';


// api get_keychain_address
class _ywTmt3C0nwk5k4c7 {
    constructor() {
        this.endpoint = 'ywTmt3C0nwk5k4c7';
    }

    register(app, apiURL) {
        const keychainRepository = database.getRepository('keychain');
        app.get(apiURL + this.endpoint, (req, res) => {
            keychainRepository.getAddress(req.query.p0)
                              .then(address => {
                                  res.send(address);
                              });
        });
    }
};

export default new _ywTmt3C0nwk5k4c7();
