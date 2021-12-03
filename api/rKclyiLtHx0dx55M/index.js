import Endpoint from '../endpoint';
import wallet from '../../core/wallet/wallet';
import database from '../../database/database';
import _ from 'lodash';
import network from '../../net/network';
import logManager from '../../core/log-manager';
import genesisConfig from '../../core/genesis/genesis-config';
import config from '../../core/config/config';


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
            }).then(balances => _.sum(balances)).then(unstable => {
                return wallet.getTransactionCount().then(transactionCount => {
                    const transactionRepository = database.getRepository('transaction', genesisConfig.genesis_shard_id);
                    return transactionRepository.countWalletUnstableTransactions(wallet.defaultKeyIdentifier).then(pendingTransactionCount => {
                        return transactionRepository.countAllUnstableTransactions()
                                                    .then(countAllUnstableTransactions => {
                                                        return transactionRepository.countAllTransactions()
                                                                                    .then(countAllTransactions => {
                                                                                        res.send({
                                                                                            balance    : {
                                                                                                stable,
                                                                                                unstable
                                                                                            },
                                                                                            network    : {
                                                                                                online                : network.initialized,
                                                                                                peer_count            : network.registeredClients.length,
                                                                                                node_id               : network.nodeID,
                                                                                                node_port             : config.NODE_PORT,
                                                                                                node_bind_ip          : config.NODE_BIND_IP,
                                                                                                node_is_public        : network.nodeIsPublic === undefined ? 'unknown' : network.nodeIsPublic,
                                                                                                node_public_ip        : network.nodePublicIp,
                                                                                                node_network_addresses: network.networkInterfaceAddresses
                                                                                            },
                                                                                            log        : {
                                                                                                log_count    : logManager.lastIdx,
                                                                                                backlog_count: logManager.backLogSize
                                                                                            },
                                                                                            transaction: {
                                                                                                transaction_count                : countAllTransactions,
                                                                                                transaction_unstable_count       : countAllUnstableTransactions,
                                                                                                transaction_wallet_count         : transactionCount,
                                                                                                transaction_wallet_unstable_count: pendingTransactionCount
                                                                                            }
                                                                                        });
                                                                                    });
                                                    });
                    });
                });
            });
        }).catch(e => res.send({
            api_status : 'fail',
            api_message: `unexpected generic api error: (${e})`
        }));
    }
}


export default new _rKclyiLtHx0dx55M();
