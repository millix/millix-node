import Endpoint from '../endpoint';
import walletEscrow from '../../core/wallet/wallet-escrow';


/**
 * api claim_escrow
 */
class _7ZsDVit9iFhzZNwC extends Endpoint {
    constructor() {
        super('7ZsDVit9iFhzZNwC');
    }

    /**
     * payee: claims the portions earned by the latest receipt of an escrow
     * that pays this node. the rest stays locked in the escrow.
     * @param app
     * @param req (p0: escrow_address_base<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (!req.query.p0) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<escrow_address_base> is required'
            });
        }

        walletEscrow.claim(req.query.p0)
                    .then(result => res.send({
                        api_status: 'success',
                        ...result
                    }))
                    .catch(e => res.send({
                        api_status : 'fail',
                        api_message: `${e}`
                    }));
    }
}


export default new _7ZsDVit9iFhzZNwC();
