import Endpoint from '../endpoint';
import wallet from '../../core/wallet/wallet';
import database from '../../database/database';
import _ from 'lodash';
import network from '../../net/network';
import logManager from '../../core/log-manager';
import genesisConfig from '../../core/genesis/genesis-config';
import config from '../../core/config/config';
import cache from '../../core/cache';
import mutex from '../../core/mutex';
import walletTransactionConsensus from '../../core/wallet/wallet-transaction-consensus';


/**
 * api get_stat_summary
 */
class _rKclyiLtHx0dx55M extends Endpoint {
    constructor() {
        super('rKclyiLtHx0dx55M');
        this.lastWalletId = '';
    }

    getCachedIfPresent(key, getter, cacheTime = 15000, onUpdate = null) {
        return cache.getCachedIfPresent('api_stats', key, getter, cacheTime, onUpdate);
    }

    refreshCacheTime(key, cacheTime = 15000) {
        return cache.refreshCacheTime('api_stats', key, cacheTime);
    }

    clearCacheItem(key) {
        cache.removeCacheItem('api_stats', key);
    }

    clearCache() {
        cache.removeCacheItem('api_stats', 'wallet_spent_output_count_and_balance');
        cache.removeCacheItem('api_stats', 'wallet_balance');
        cache.removeCacheItem('api_stats', 'count_wallet_total');
        cache.removeCacheItem('api_stats', 'count_wallet_unstable');
        cache.removeCacheItem('api_stats', 'count_unstable');
        cache.removeCacheItem('api_stats', 'count_all');
    }

    /**
     * returns the node stat summary
     * @param app
     * @param req
     * @param res
     */
    handler(app, req, res) {
        const walletID = wallet.getDefaultActiveWallet();
        if (this.lastWalletId !== walletID) {
            this.lastWalletId = walletID;
            this.clearCache();
        }
        const maxUnstableOutputCount = 100000;
        database.getRepository('address');
        mutex.lock(['get_stat_summary'], unlock => {
            this.getCachedIfPresent('wallet_spent_output_count_and_balance', () => database.applyShards((shardID) => {
                const transactionRepository = database.getRepository('transaction', shardID);
                return transactionRepository.countTransactionOutputs({
                    address_key_identifier: wallet.defaultKeyIdentifier,
                    is_spent              : 0,
                    is_double_spend       : 0,
                    'status!'             : 3
                });
            }).then(unspentOutputCountList => {
                const unspentOutputCount = _.sum(unspentOutputCountList);

                if (unspentOutputCount <= maxUnstableOutputCount) {
                    return this.getCachedIfPresent('wallet_balance', () => database.applyShards((shardID) => {
                        const transactionRepository = database.getRepository('transaction', shardID);
                        return transactionRepository.getWalletBalance(wallet.defaultKeyIdentifier, true);
                    }).then(stableBalances => database.applyShards((shardID) => {
                        const transactionRepository = database.getRepository('transaction', shardID);
                        return transactionRepository.getWalletBalance(wallet.defaultKeyIdentifier, false);
                    }).then(unstableBalances => ([
                        _.sum(stableBalances),
                        _.sum(unstableBalances)
                    ])))).then(([stableBalances, unstableBalances]) => ([
                        unspentOutputCount,
                        stableBalances,
                        unstableBalances
                    ]));
                }
                else {
                    return [
                        unspentOutputCount,
                        0,
                        0
                    ];
                }
            }), 5 * 60 * 1000, ([unspentOutputCount]) => {
                if (unspentOutputCount <= maxUnstableOutputCount) {
                    this.refreshCacheTime('wallet_spent_output_count_and_balance', 15000);
                }
            }).then(([unspentOutputCount, stable, unstable]) => {
                return this.getCachedIfPresent('count_wallet_total', () => wallet.getTransactionCount())
                           .then(transactionCount => {
                               const transactionRepository = database.getRepository('transaction', genesisConfig.genesis_shard_id);
                               return this.getCachedIfPresent('count_wallet_unstable', () => transactionRepository.countWalletUnstableTransactions(wallet.defaultKeyIdentifier))
                                          .then(pendingTransactionCount => {
                                              return this.getCachedIfPresent('count_unstable', () => transactionRepository.countAllUnstableTransactions())
                                                         .then(countAllUnstableTransactions => {
                                                             return this.getCachedIfPresent('count_all', () => transactionRepository.countAllTransactions())
                                                                        .then(countAllTransactions => {
                                                                            unlock();
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
                                                                                    transaction_wallet_unstable_count: pendingTransactionCount,
                                                                                    transaction_wallet_unspent_count : unspentOutputCount,
                                                                                    transaction_validation_count     : walletTransactionConsensus.transactionValidationCount
                                                                                }
                                                                            });
                                                                        });
                                                         });
                                          });
                           });
            }).catch(e => {
                unlock();
                res.send({
                    api_status : 'fail',
                    api_message: `unexpected generic api error: (${e})`
                });
            });
        });
    }
}


export default new _rKclyiLtHx0dx55M();
