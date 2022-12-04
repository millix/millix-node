import Endpoint from '../endpoint';
import wallet from '../../core/wallet/wallet';
import database from '../../database/database';
import _ from 'lodash';
import config from '../../core/config/config';


/**
 * api get_unspent_output_summary
 */
class _FC8ylC617zzn1Gaa extends Endpoint {
    constructor() {
        super('FC8ylC617zzn1Gaa');
    }

    /**
     * returns the unspent output stat summary
     * @param app
     * @param req
     * @param res
     */
    handler(app, req, res) {
        database.applyShards((shardID) => {
            const transactionRepository = database.getRepository('transaction', shardID);
            return transactionRepository.countWalletFreeOutput(wallet.defaultKeyIdentifier);
        }).then(unstableTransactionCounts => database.applyShards((shardID) => {
            const transactionRepository = database.getRepository('transaction', shardID);
            return transactionRepository.listTransactionOutput({
                address_key_identifier               : wallet.defaultKeyIdentifier,
                is_spent                             : 0,
                is_double_spend                      : 0,
                'transaction_output.is_stable'       : 1,
                'transaction_output.status!'         : 3,
                'transaction_output.address_not-like': [`%${config.ADDRESS_VERSION_NFT}%`, `%${config.ADDRESS_VERSION_BRIDGE}%`]
            }, 'amount', 128);
        }, 'amount', 128).then(unspentOutputs => {
            res.send({
                transaction_output_count: _.sum(unstableTransactionCounts),
                transaction_max_amount  : _.sum(_.map(unspentOutputs, output => output.amount))
            });
        })).catch(e => {
            res.send({
                api_status : 'fail',
                api_message: `unexpected generic api error: (${e})`
            });
        });
    }
}


export default new _FC8ylC617zzn1Gaa();
