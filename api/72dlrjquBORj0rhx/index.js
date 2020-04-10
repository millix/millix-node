import database from '../../database/database';


// api list_address
class _72dlrjquBORj0rhx {
    constructor() {
        this.endpoint = '72dlrjquBORj0rhx';
    }

    register(app, apiURL) {
        const addressRepository = database.getRepository('address');
        app.get(apiURL + this.endpoint, (_, res) => {
            addressRepository.getAllAddress()
                             .then(addresses => res.send(addresses));
        });
    }
};

export default new _72dlrjquBORj0rhx();
