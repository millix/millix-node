import Endpoint from '../endpoint';
import broker from '../../net/broker/broker';


/**
 * api pay_cloud_broker_host
 */
class _X5u7FyA1PyGfE4fi extends Endpoint {
    constructor() {
        super('X5u7FyA1PyGfE4fi');
    }

    /**
     * broker: pays the exit nodes owed at least CLOUD_BROKER_PAYOUT_AMOUNT_MIN
     * now instead of at the next payout
     * @param app
     * @param req
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (!broker.isRunning()) {
            return res.send({
                api_status : 'fail',
                api_message: 'broker_not_running'
            });
        }
        broker.doPayout()
              .then(transactionList => res.send({
                  api_status         : 'success',
                  transaction_id_list: transactionList.map(transaction => transaction.transaction_id)
              }))
              .catch(e => res.send({
                  api_status : 'fail',
                  api_message: `${e?.error || e}`
              }));
    }
}


export default new _X5u7FyA1PyGfE4fi();
