import Endpoint from '../endpoint';
import broker from '../../net/broker/broker';
import config from '../../core/config/config';


/**
 * api list_cloud_broker_trial_block
 */
class _icSqcOnTkn4QEUGl extends Endpoint {
    constructor() {
        super('icSqcOnTkn4QEUGl');
    }

    /**
     * broker: returns whether this broker offers the free trial, its data
     * and the exit nodes the trial does not extend to, with the date each
     * was added
     * @param app
     * @param req
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        broker.listTrialBlock()
              .then(trialBlockList => res.send({
                  api_status      : 'success',
                  trial_offered   : broker.isTrialOffered(),
                  trial_data_bytes: config.CLOUD_BROKER_TRIAL_DATA_BYTES,
                  trial_block_list: trialBlockList
              }))
              .catch(e => res.send({
                  api_status : 'fail',
                  api_message: `${e?.message || e?.error || e}`
              }));
    }
}


export default new _icSqcOnTkn4QEUGl();
