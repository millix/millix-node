import database from '../../database/database';
import Endpoint from '../endpoint';
import genesisConfig from '../../core/genesis/genesis-config';
import _ from 'lodash';


/**
 * api get_known_address_balance
 */
class _xGaf7vbfY15TGsSd extends Endpoint {
    constructor() {
        super('xGaf7vbfY15TGsSd');
    }

    /**
     * returns the available (stable) balance and pending (unstable) balance of
     * all known addresses
     * @param app
     * @param req
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const transactionRepository = database.getRepository('transaction', genesisConfig.genesis_shard_id);
        transactionRepository.getAllAddressBalance(true)
                             .then(stableBalance => {
                                 const balance = {};
                                 return transactionRepository.getAllAddressBalance(false)
                                                             .then(pendingBalance => {
                                                                 _.each(stableBalance, item => balance[item.address] = {
                                                                     ...item,
                                                                     balance_pending: _.find(pendingBalance, {address: item.address})?.balance_pending || 0
                                                                 });
                                                                 _.each(pendingBalance, item => {
                                                                     if (!balance[item.address]) {
                                                                         balance[item.address] = {
                                                                             address        : item.address,
                                                                             balance_stable : 0,
                                                                             balance_pending: item.balance_pending
                                                                         };
                                                                     }
                                                                     else {
                                                                         balance[item.address]['balance_pending'] = item.balance_pending;
                                                                     }
                                                                 });
                                                                 res.send(_.values(balance));
                                                             });
                             })
                             .catch(e => res.send({
                                 api_status : 'fail',
                                 api_message: `unexpected generic api error: (${e})`
                             }));
    }
}


export default new _xGaf7vbfY15TGsSd();
