import database from '../../database/database';
import peer from '../../net/peer';
import Endpoint from '../endpoint';
import _ from 'lodash';
import walletSync from '../../core/wallet/wallet-sync';


/**
 * api get_transaction_extended
 */
class _IBHgAmydZbmTUAe8 extends Endpoint {
    constructor() {
        super('IBHgAmydZbmTUAe8');
    }

    /**
     * returns a single record with all information about a transaction as
     * indicated by transaction_id in the indicated shard
     * @param app
     * @param req (p0: transaction_id<required>, p1: shard_id<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (!req.query.p0 || !req.query.p1) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<transaction_id> and p1<shard_id> are required'
            });
        }
        database.firstShardORShardZeroRepository('transaction', req.query.p1, transactionRepository => {
            return new Promise((resolve, reject) => {
                transactionRepository.getTransactionExtended({
                    '`transaction`.transaction_id': req.query.p0,
                    '`transaction`.shard_id'      : req.query.p1
                }).then(data => data.length > 0 ? resolve(data) : reject()).catch(reject);
            });
        }).then(data => {
            if (!data || data.length === 0) {
                peer.transactionSyncRequest(req.query.p0).then(_ => _).catch(_ => _);
                return this._getErrorStatus(req.query.p0).then(errorStatus => res.send({
                    api_status : errorStatus,
                    api_message: `the transaction with id ${req.query.p0} was not found at shard ${req.query.p1}`
                }));
            }

            const parentSet = {};
            _.each(data, row => parentSet[row.transaction_id_parent] = null);
            const parentTransactionListID = Object.keys(parentSet);
            return database.applyShards((shardID) => {
                return database.getRepository('transaction', shardID)
                               .listTransactions({'transaction_id_in': parentTransactionListID});
            }).then(parentTransactionList => {
                _.each(parentTransactionList, parentTransaction => {
                    if(!parentSet[parentTransaction.transaction_id]) {
                        parentSet[parentTransaction.transaction_id] = parentTransaction.shard_id;
                    }
                });
                _.each(data, transaction => transaction.shard_id_parent = parentSet[transaction.transaction_id_parent] || null);
                return data;
            });
        }).then(data => {
            const normalization = database.getRepository('normalization');
            const transaction   = {};
            _.extend(transaction, _.pick(data[0], 'transaction_id', 'shard_id', 'transaction_date', 'node_id_origin', 'node_id_proxy', 'version', 'payload_hash', 'stable_date', 'is_stable', 'parent_date', 'is_parent', 'timeout_date', 'is_timeout', 'status', 'create_date'));
            if (!!transaction.transaction_date) {
                transaction['transaction_date'] = Math.floor(transaction.transaction_date.getTime() / 1000);
            }

            const signatures       = new Set();
            const inputs           = new Set();
            const outputs          = new Set();
            const outputAttributes = new Set();
            const parents          = new Set();

            transaction['transaction_signature_list'] = [];
            transaction['transaction_input_list']     = [];
            transaction['transaction_output_list']    = [];
            transaction['transaction_parent_list']    = [];

            let keyMap = {
                'signature_status'              : 'status',
                'signature_create_date'         : 'create_date',
                'input_double_spend_date'       : 'double_spend_date',
                'input_is_double_spend'         : 'is_double_spend',
                'input_address_key_identifier'  : 'address_key_identifier',
                'input_output_position'         : 'output_position',
                'input_output_shard_id'         : 'output_shard_id',
                'input_output_transaction_date' : 'output_transaction_date',
                'input_output_transaction_id'   : 'output_transaction_id',
                'input_address'                 : 'address',
                'input_status'                  : 'status',
                'input_create_date'             : 'create_date',
                'output_address'                : 'address',
                'output_address_key_identifier' : 'address_key_identifier',
                'output_stable_date'            : 'stable_date',
                'output_is_stable'              : 'is_stable',
                'output_double_spend_date'      : 'double_spend_date',
                'output_is_double_spend'        : 'is_double_spend',
                'output_status'                 : 'status',
                'output_create_date'            : 'create_date',
                'output_attribute_status'       : 'status',
                'output_attribute_create_date'  : 'create_date',
                'transaction_parent_status'     : 'status',
                'transaction_parent_create_date': 'create_date'
            };

            const keyMapFunction = (v, k) => keyMap[k] ? keyMap[k] : k;

            data.forEach(row => {
                if (!signatures.has(row.address_base)) {
                    signatures.add(row.address_base);
                    transaction['transaction_signature_list'].push(_.mapKeys(_.pick(row, 'address_base', 'signature', 'signature_status', 'signature_create_date'), keyMapFunction));
                }

                if (!inputs.has(row.input_position)) {
                    inputs.add(row.input_position);
                    transaction['transaction_input_list'].push(_.mapKeys(_.pick(row, 'input_position', 'input_output_transaction_id', 'input_output_shard_id', 'input_output_position', 'input_output_transaction_date', 'input_double_spend_date', 'input_is_double_spend', 'input_address', 'input_address_key_identifier', 'input_status', 'input_create_date'), keyMapFunction));
                }

                if (!outputs.has(row.output_position)) {
                    outputs.add(row.output_position);
                    transaction['transaction_output_list'].push(_.mapKeys(_.pick(row, 'output_position', 'output_address', 'output_address_key_identifier', 'amount', 'output_stable_date', 'output_is_stable', 'spent_date', 'is_spent', 'output_double_spend_date', 'output_is_double_spend', 'output_status', 'output_create_date'), keyMapFunction));
                }

                if (row.output_attribute_type_id && !outputAttributes.has(row.output_attribute_type_id)) {
                    outputAttributes.add(row.output_attribute_type_id);
                    try {
                        transaction['transaction_output_attribute'] = {[normalization.getType(row.output_attribute_type_id)]: JSON.parse(row.output_attribute_value)};
                    }
                    catch (e) {
                        throw new Error('invalid_transaction_output_attribute');
                    }
                }

                if (row.transaction_id_parent && !parents.has(row.transaction_id_parent)) {
                    parents.add(row.transaction_id_parent);
                    transaction['transaction_parent_list'].push(_.mapKeys(_.pick(row, 'transaction_id_parent', 'shard_id_parent', 'transaction_id_child', 'shard_id_child', 'transaction_parent_status', 'transaction_parent_create_date'), keyMapFunction));
                }

            });

            res.send(transaction);
        }).catch(e => res.send({
            api_status : 'fail',
            api_message: `unexpected generic api error: (${e})`
        }));
    }

    _getErrorStatus(transactionID) {
        return walletSync.getTransactionData(transactionID)
                         .then((data) => {
                             if (!data) {
                                 return 'fail:not_found';
                             }
                             else if (data.type === 'sync') {
                                 return 'fail:not_found:pending';
                             }
                             else if (data.type === 'unresolved') {
                                 return 'fail:not_found:timeout';
                             }
                             else {
                                 throw new Error('unexpected error');
                             }
                         });
    }
}


export default new _IBHgAmydZbmTUAe8();
