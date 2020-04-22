import database from '../../database/database';
import Endpoint from '../endpoint';


// api list_config
class _CZOTAF5LfusB1Ht5 extends Endpoint {
    constructor() {
        super('CZOTAF5LfusB1Ht5');
    }

    handler(app, req, res) {
        const configurationRepository = database.getRepository('config');
        configurationRepository.getAll()
                               .then(configurations => res.send(configurations));
    }
};

export default new _CZOTAF5LfusB1Ht5();
