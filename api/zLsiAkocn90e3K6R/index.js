import database from '../../database/database';
import Endpoint from '../endpoint';
import _ from 'lodash';


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
                api_status : 'fail',
                api_message: 'p0<address> is required'
            });
        }

        database.applyShards((shardID) => {
            const transactionRepository = database.getRepository('transaction', shardID);
            return transactionRepository.getAddressBalance(req.query.p0, true);
        }).then(balances => _.sum(balances)).then(stable => {
            return database.applyShards((shardID) => {
                const transactionRepository = database.getRepository('transaction', shardID);
                return transactionRepository.getAddressBalance(req.query.p0, false);
            }).then(balances => _.sum(balances)).then(unstable => res.send({
                stable,
                unstable
            }));
        }).catch(e => res.send({
            api_status : 'fail',
            api_message: `unexpected generic api error: (${e})`
        }));
    }
}


export default new _zLsiAkocn90e3K6R();
