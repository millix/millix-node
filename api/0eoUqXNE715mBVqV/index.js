import database from '../../database/database';
import Endpoint from '../endpoint';


/**
 * api list_node
 */
class _0eoUqXNE715mBVqV extends Endpoint {
    constructor() {
        super('0eoUqXNE715mBVqV');
    }

    /**
     * returns a list of peer nodes known by the host.  it returns the newest
     * records by default
     * @param app
     * @param req (p0: status, p1: order_by="create_date desc", p2:
     *     record_limit=1000)
     * @param res
     */
    handler(app, req, res) {
        const status         = req.query.p0;
        const orderBy        = req.query.p1 || 'create_date desc';
        const limit          = parseInt(req.query.p2) || 1000;
        const nodeRepository = database.getRepository('node');
        nodeRepository.listNodes({status}, orderBy, limit)
                      .then(nodes => {
                          res.send(nodes);
                      })
                      .catch(e => res.send({
                          api_status : 'fail',
                          api_message: `unexpected generic api error: (${e})`
                      }));
    }
}


export default new _0eoUqXNE715mBVqV();
