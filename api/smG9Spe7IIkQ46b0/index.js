import Endpoint from '../endpoint';
import passWallet from '../../net/broker/pass-wallet';


/**
 * api buy_cloud_pass
 */
class _smG9Spe7IIkQ46b0 extends Endpoint {
    constructor() {
        super('smG9Spe7IIkQ46b0');
    }

    /**
     * pays a broker's pass price from this wallet for a pass. the broker's
     * prepaid certificate is fetched once the payment is stable: the pass is
     * active when list_cloud_pass shows status active.
     * @param app
     * @param req (p0: broker_address, defaults to the first broker of
     *     CLOUD_BROKER_LIST)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        passWallet.buyPass(req.query.p0 || undefined)
                  .then(pass => res.send({
                      api_status: 'success',
                      pass
                  }))
                  .catch(e => res.send({
                      api_status : 'fail',
                      api_message: `${e?.error || e}`
                  }));
    }
}


export default new _smG9Spe7IIkQ46b0();
