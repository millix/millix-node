import database from '../../database/database';


// api list_config
class _CZOTAF5LfusB1Ht5 {
    constructor() {
        this.endpoint = 'CZOTAF5LfusB1Ht5';
    }

    register(app, apiURL) {
        const configurationRepository = database.getRepository('config');
        app.get(apiURL + this.endpoint, (req, res) => {
            configurationRepository.getAll()
                                   .then(configurations => res.send(configurations));
        });
    }
};

export default new _CZOTAF5LfusB1Ht5();
