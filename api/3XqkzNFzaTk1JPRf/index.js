import database from '../../database/database';


// api list_address_version
class _3XqkzNFzaTk1JPRf {
    constructor() {
        this.endpoint = '3XqkzNFzaTk1JPRf';
    }

    register(app, apiURL) {
        const addressRepository = database.getRepository('address');
        app.get(apiURL + this.endpoint, (_, res) => {
            res.send(addressRepository.addressVersionList);
        });
    }
};

export default new _3XqkzNFzaTk1JPRf();
