import database from '../../database/database';
import Endpoint from '../endpoint';


// api list_peer
class _0eoUqXNE715mBVqV extends Endpoint {
    constructor() {
        super('0eoUqXNE715mBVqV');
    }

    handler(app, req, res) {
        const nodeRepository = database.getRepository('node');
        nodeRepository.getNodes()
                      .then(nodes => {
                          res.send(nodes);
                      });
    }
}


export default new _0eoUqXNE715mBVqV();
