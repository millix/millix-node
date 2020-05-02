import database from '../../database/database';
import Endpoint from '../endpoint';


// api list_peer
class _0eoUqXNE715mBVqV extends Endpoint {
    constructor() {
        super('0eoUqXNE715mBVqV');
    }

    handler(app, req, res) {
        const status         = parseInt(req.query.p0) || 1;
        const limit          = parseInt(req.query.p1) || 1000;
        const nodeRepository = database.getRepository('node');
        nodeRepository.listNodes({status}, limit)
                      .then(nodes => {
                          res.send(nodes);
                      });
    }
}


export default new _0eoUqXNE715mBVqV();
