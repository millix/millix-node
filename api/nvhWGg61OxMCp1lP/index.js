import Endpoint from '../endpoint';
import broker from '../../net/broker/broker';
import database from '../../database/database';


/**
 * api list_cloud_broker_host
 */
class _nvhWGg61OxMCp1lP extends Endpoint {
    constructor() {
        super('nvhWGg61OxMCp1lP');
    }

    /**
     * broker: returns the exit nodes this broker pays, with what their
     * receipts earned, what was paid and what is owed, and the payouts
     * @param app
     * @param req
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        Promise.all([
            broker.listHost(),
            database.getRepository('cloud_broker').listPayout(undefined, 'create_date desc', 1000)
        ]).then(([hostList, payoutList]) => res.send({
            api_status : 'success',
            broker     : broker.isRunning() ? broker.getTerms() : null,
            host_list  : hostList,
            payout_list: payoutList
        })).catch(e => res.send({
            api_status : 'fail',
            api_message: `${e?.error || e}`
        }));
    }
}


export default new _nvhWGg61OxMCp1lP();
