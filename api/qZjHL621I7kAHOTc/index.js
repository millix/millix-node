import Endpoint from '../endpoint';
import passWallet from '../../net/broker/pass-wallet';


/**
 * api list_cloud_pass
 */
class _qZjHL621I7kAHOTc extends Endpoint {
    constructor() {
        super('qZjHL621I7kAHOTc');
    }

    /**
     * returns the broker passes this node bought, with their certificates
     * and the pieces fetched so far
     * @param app
     * @param req (p0: status)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        passWallet.listPass(req.query.p0 ? {status: req.query.p0} : undefined)
                  .then(passList => res.send({
                      api_status: 'success',
                      pass_list : passList
                  }))
                  .catch(e => res.send({
                      api_status : 'fail',
                      api_message: `${e?.error || e}`
                  }));
    }
}


export default new _qZjHL621I7kAHOTc();
