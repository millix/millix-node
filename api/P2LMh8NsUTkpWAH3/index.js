import wallet from '../../core/wallet/wallet';
import Endpoint from '../endpoint';


/**
 * api reset_validation_transaction_by_guid
 */
class _P2LMh8NsUTkpWAH3 extends Endpoint {
    constructor(props) {
        super('P2LMh8NsUTkpWAH3');
    }

    /**
     * this API reset transaction validation by transaction guid
     * @param app
     * @param req
     * @param res
     */
    handler(app, req, res) {
        if (req.method === 'POST') {
            if (!req.body.p0) {
                return res
                    .status(400)
                    .send({
                        api_status : 'fail',
                        api_message: `p0<transaction_guid>is required`
                    });
            }
            let transactionID = req.body.p0;
            wallet.resetTransactionValidationByGuid(transactionID)
                  .then((result) => res.send({
                      api_status: 'success',
                      result    : result
                  }))
                  .catch(e => res.send({
                      api_status : 'fail',
                      api_message: `unexpected generic api error: (${e})`
                  }));
        }
        else {
            return res
                .status(400)
                .send({
                    api_status : 'fail',
                    api_message: 'POST only'
                });
        }
    }
}


export default new _P2LMh8NsUTkpWAH3();
