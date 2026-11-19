import Endpoint from '../endpoint';
import passWallet from '../../net/broker/pass-wallet';


/**
 * api new_cloud_trial_pass
 */
class _baHGR6wzIc1O41cU extends Endpoint {
    constructor() {
        super('baHGR6wzIc1O41cU');
    }

    /**
     * asks a broker for its free trial: a prepaid certificate of the
     * broker's trial data without payment. this wallet gets one trial
     * certificate from each broker; once active the trial is a pass in
     * list_cloud_pass and opens sessions like one.
     * @param app
     * @param req (p0: broker_address, defaults to the first broker of
     *     CLOUD_BROKER_LIST)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        passWallet.requestTrial(req.query.p0 || undefined)
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


export default new _baHGR6wzIc1O41cU();
