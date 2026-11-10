import Endpoint from '../endpoint';
import walletEscrow from '../../core/wallet/wallet-escrow';


/**
 * api refund_escrow
 */
class _8RCd8C2m43g7xLIR extends Endpoint {
    constructor() {
        super('8RCd8C2m43g7xLIR');
    }

    /**
     * payer: after its unlock date, returns what is left in an escrow this
     * node paid into to this wallet
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

        walletEscrow.refund(req.query.p0)
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


export default new _8RCd8C2m43g7xLIR();
