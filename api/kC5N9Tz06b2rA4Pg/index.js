import Endpoint from '../endpoint';
import mutex from '../../core/mutex';
import wallet from '../../core/wallet/wallet';


/**
 * api send_aggregation_transaction_from_wallet
 */
class _kC5N9Tz06b2rA4Pg extends Endpoint {
    constructor() {
        super('kC5N9Tz06b2rA4Pg');
    }

    /**
     * submits a new aggregation transaction from the active wallet which
     * optimizes the funds and allows spending more funds in fewer
     * transactions. this API builds the tx payload and submits it
     * @param app
     * @param req
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        mutex.lock(['submit_transaction'], (unlock) => {
            wallet.aggregateOutputs()
                  .then(transaction => {
                      unlock();
                      res.send({
                          api_status: 'success',
                          transaction
                      });
                  })
                  .catch(e => {
                      console.log(`[api ${this.endpoint}] error: ${e}`);
                      unlock();
                      res.send({
                          api_status : 'fail',
                          api_message: `unexpected generic api error: (${e.message})`
                      });
                  });
        });
    }
}


export default new _kC5N9Tz06b2rA4Pg();
