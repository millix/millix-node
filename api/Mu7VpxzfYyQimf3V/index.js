import Endpoint from '../endpoint';
import database from '../../database/database';
import async from 'async';
import _ from 'lodash';
import fileManager from '../../core/storage/file-manager';
import wallet from '../../core/wallet/wallet';


/**
 * api list_transaction_output_attribute_received
 */
class _Mu7VpxzfYyQimf3V extends Endpoint {
    constructor() {
        super('Mu7VpxzfYyQimf3V');
        this.normalizationRepository = database.getRepository('normalization');
    }

    /**
     *
     * @param app
     * @param req (p0: date_begin, p1: date_end, p2: node_id_origin, p3:
     *     is_stable, p4: is_parent, p5: is_timeout, p6: create_date_begin, p7:
     *     create_date_end, p8: status, p9: version,
     *     p10:address_key_identifier, p11: attribute_type_id, p12: data_type,
     *     p13:order_by="create_date desc", p14: record_limit=1000, p15:
     *     shard_id)
     * @param res
     */
    handler(app, req, res) {
        const orderBy  = req.query.p13 || '`transaction`.create_date desc';
        const limit    = parseInt(req.query.p14) || 1000;
        const shardID  = req.query.p15 || undefined;
        const dataType = req.query.p12 || undefined;

        database.applyShards((dbShardID) => {
            const transactionRepository = database.getRepository('transaction', dbShardID);
            if (!transactionRepository) {
                return Promise.resolve([]);
            }
            return transactionRepository.listTransactionOutput({
                '`transaction`.transaction_date_begin': req.query.p0,
                '`transaction`.transaction_date_end'  : req.query.p1,
                '`transaction`.node_id_origin'        : req.query.p2,
                '`transaction`.is_stable'             : req.query.p3,
                '`transaction`.is_parent'             : req.query.p4,
                '`transaction`.is_timeout'            : req.query.p5,
                '`transaction`.create_date_begin'     : req.query.p6,
                '`transaction`.create_date_end'       : req.query.p7,
                '`transaction`.status'                : req.query.p8,
                '`transaction`.version'               : req.query.p9,
                'address_key_identifier'              : req.query.p10,
                'is_spent'                            : dataType === 'tangled_nft' ? 0 : undefined,
                'output_position!'                    : -1, //discard fee output
                '`transaction`.shard_id'              : shardID
            }, orderBy, limit);
        }, orderBy, limit, shardID).then(outputList => {
            const data = outputList.map(output => ({
                transaction_id           : output.transaction_id,
                transaction_date         : output.transaction_date,
                amount                   : output.amount,
                address_key_identifier_to: output.address_key_identifier,
                address_to               : output.address,
                output_position          : output.output_position,
                is_stable                : output.is_stable
            }));
            // define from
            return new Promise((resolve) => {
                async.eachSeries(data, (transaction, callback) => {
                    database.firstShards((shardID) => {
                        const transactionRepository = database.getRepository('transaction', shardID);
                        return transactionRepository.getTransactionInput({
                            'transaction_id': transaction.transaction_id,
                            'input_position': 0
                        });
                    }).then(input => {
                        if (!input) {
                            return Promise.reject('transaction_output_not_found');
                        }
                        transaction['address_key_identifier_from'] = input.address_key_identifier;
                        transaction['address_from']                = input.address;
                        callback();
                    });
                }, () => resolve(data));
            });
        }).then(data => {
            const transactionLastOutputPosition = {};
            _.each(data, row => {
                if (!transactionLastOutputPosition[row.transaction_id] || transactionLastOutputPosition[row.transaction_id] < row.output_position) {
                    transactionLastOutputPosition[row.transaction_id] = row.output_position;
                }
            });
            // filter data where sender equals to receiver
            data = _.filter(data, row => !(transactionLastOutputPosition[row.transaction_id] === row.output_position /* last output */
                                           && row.address_key_identifier_to === row.address_key_identifier_from /* sender is the receiver */
                                           && row.output_position !== 0 /* not single output transaction */));

            const dataToRemove = new Set();

            // get data
            async.eachSeries(data, (transaction, callback) => {
                database.applyShards((shardID) => {
                    const transactionRepository = database.getRepository('transaction', shardID);
                    return transactionRepository.listTransactionOutputAttributes({
                        transaction_id   : transaction.transaction_id,
                        attribute_type_id: req.query.p11
                    });
                }, orderBy, limit, shardID)
                        .then(attributes => {
                            async.eachSeries(attributes, (attribute, attributeCallback) => {
                                attribute.value = JSON.parse(attribute.value);
                                if (attribute.attribute_type_id === this.normalizationRepository.get('transaction_output_metadata')) {
                                    if (!attribute.value.file_list || attribute.value.file_list.length === 0) {
                                        dataToRemove.add(transaction);
                                        return attributeCallback();
                                    }

                                    attribute.value.file_data = {};
                                    async.eachSeries(attribute.value.file_list, (file, fileReadCallback) => {
                                        const key = file.key || file[wallet.defaultKeyIdentifier]?.key;
                                        if (!key) {
                                            return fileReadCallback();
                                        }

                                        let fileType = file.type;
                                        if (fileType.endsWith('_meta')) {
                                            fileType = fileType.substring(0, fileType.length - 5);
                                        }
                                        if (dataType && (fileType !== dataType)) {
                                            dataToRemove.add(transaction);
                                            return fileReadCallback();
                                        }

                                        fileManager.decryptFile(transaction.address_key_identifier_from, transaction.transaction_date, transaction.transaction_id, file.hash, key, file.public)
                                                   .then(fileData => {
                                                       attribute.value.file_data[file.hash] = JSON.parse(fileData.toString());
                                                       fileReadCallback();
                                                   }).catch(() => fileReadCallback());
                                    }, () => attributeCallback());
                                }
                                else {
                                    attributeCallback();
                                }
                            }, () => {
                                transaction.transaction_output_attribute = attributes;
                                callback();
                            });
                        });
            }, () => {
                _.pull(data, ...dataToRemove);
                res.send(data);
            });
        }).catch(e => res.send({
            api_status : 'fail',
            api_message: `unexpected generic api error: (${e})`
        }));
    }
}


export default new _Mu7VpxzfYyQimf3V();
