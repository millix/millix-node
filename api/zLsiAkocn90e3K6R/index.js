import database from '../../database/database';
import Endpoint from '../endpoint';


/**
 * api get_address_balance
 */
class _zLsiAkocn90e3K6R extends Endpoint {
    constructor() {
        super('zLsiAkocn90e3K6R');
    }

    /**
     * returns the available (stable) balance and pending (unstable) balance of
     * an address
     * @param app
     * @param req (p0: address<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (!req.query.p0) {
            return res.status(400).send({
                status : 'fail',
                message: 'p0<address> is required'
            });
        }

        const transactionRepository = database.getRepository('transaction');
        transactionRepository.getAddressBalance(req.query.p0, true)
                             .then(stable => {
                                 transactionRepository.getAddressBalance(req.query.p0, false)
                                                      .then(unstable => res.send({
                                                          stable,
                                                          unstable
                                                      }));
                             });
    }
}


export default new _zLsiAkocn90e3K6R();
