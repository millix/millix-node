import Endpoint from '../endpoint';
import wallet from '../../core/wallet/wallet';
import database from '../../database/database';
import _ from 'lodash';
import network from '../../net/network';
import logManager from '../../core/log-manager';


/**
 * api get_stat_summary
 */
class _rKclyiLtHx0dx55M extends Endpoint {
    constructor() {
        super('rKclyiLtHx0dx55M');
    }

    /**
     * returns the node stat summary
     * @param app
     * @param req
     * @param res
     */
    handler(app, req, res) {
        database.getRepository('address');
        database.applyShards((shardID) => {
            const transactionRepository = database.getRepository('transaction', shardID);
            return transactionRepository.getWalletBalance(wallet.defaultKeyIdentifier, true);
        }).then(balances => _.sum(balances)).then(stable => {
            return database.applyShards((shardID) => {
                const transactionRepository = database.getRepository('transaction', shardID);
                return transactionRepository.getWalletBalance(wallet.defaultKeyIdentifier, false);
            }).then(balances => _.sum(balances)).then(unstable => res.send({
                balance: {
                    stable,
                    unstable
                },
                network: {
                    online    : network.initialized,
                    peer_count: network.registeredClients.length
                },
                log    : {
                    log_count    : logManager.lastIdx,
                    backlog_count: logManager.backLogSize
                }
            }));
        }).catch(e => res.send({
            api_status : 'fail',
            api_message: `unexpected generic api error: (${e})`
        }));
    }
}


export default new _rKclyiLtHx0dx55M();
