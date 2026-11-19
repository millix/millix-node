import Endpoint from '../endpoint';
import broker from '../../net/broker/broker';


/**
 * api get_cloud_broker_report
 */
class _na8iJSKHcMSQ2OB6 extends Endpoint {
    constructor() {
        super('na8iJSKHcMSQ2OB6');
    }

    /**
     * broker: returns what this broker earned (the passes it sold, from
     * their payments) and spent (what its payouts paid exit nodes for
     * trials and for passes, and what is owed or held back), from its own
     * receipts, payments and payouts. host_list shows each exit node's trial
     * certificates, bytes and payouts, the most trial bytes first.
     * @param app
     * @param req
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        broker.getReport()
              .then(report => res.send({
                  api_status: 'success',
                  report
              }))
              .catch(e => res.send({
                  api_status : 'fail',
                  api_message: `${e?.message || e?.error || e}`
              }));
    }
}


export default new _na8iJSKHcMSQ2OB6();
