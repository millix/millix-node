import database from '../../database/database';
import Endpoint from '../endpoint';
import genesisConfig from '../../core/genesis/genesis-config';
import _ from 'lodash';


/**
 * api get_known_wallet_balance
 */
class _NPCpnfUyPHRH4j29 extends Endpoint {
    constructor() {
        super('NPCpnfUyPHRH4j29');
    }

    /**
     * returns the available (stable) balance and pending (unstable) balance of
     * all known wallet
     * @param app
     * @param req
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const transactionRepository = database.getRepository('transaction', genesisConfig.genesis_shard_id);
        transactionRepository.getAllWalletBalance(true)
                             .then(stableBalance => {
                                 const balance = {};
                                 return transactionRepository.getAllWalletBalance(false)
                                                             .then(pendingBalance => {
                                                                 _.each(stableBalance, item => balance[item.address_key_identifier] = {
                                                                     ...item,
                                                                     balance_pending: _.find(pendingBalance, {address_key_identifier: item.address_key_identifier})?.balance_pending || 0
                                                                 });
                                                                 _.each(pendingBalance, item => {
                                                                     if (!balance[item.address_key_identifier]) {
                                                                         balance[item.address_key_identifier] = {
                                                                             address_key_identifier: item.address_key_identifier,
                                                                             balance_stable        : 0,
                                                                             balance_pending       : item.balance_pending
                                                                         };
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


export default new _NPCpnfUyPHRH4j29();
