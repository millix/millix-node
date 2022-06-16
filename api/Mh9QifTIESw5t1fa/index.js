import Endpoint from '../endpoint';
import database from '../../database/database';
import async from 'async';
import _ from 'lodash';
import fileManager from '../../core/storage/file-manager';
import wallet from '../../core/wallet/wallet';


/**
 * api get_transaction_output_data
 */
class _Mh9QifTIESw5t1fa extends Endpoint {
    constructor() {
        super('Mh9QifTIESw5t1fa');
        this.normalizationRepository = database.getRepository('normalization');
    }

    /**
     *
     * @param app
     * @param req (p0: transaction_id, p1: address_key_identifier, p2:
     *     attribute_type_id, p3: file_hash)
     * @param res
     */
    handler(app, req, res) {

        database.firstShards((dbShardID) => {
            const transactionRepository = database.getRepository('transaction', dbShardID);
            return transactionRepository.getTransactionOutput({
                '`transaction`.transaction_id': req.query.p0,
                'address_key_identifier'      : req.query.p1,
                'output_position!'            : -1 //discard fee output
            });
        }).then(output => {
            const data = {
                transaction_id           : output.transaction_id,
                transaction_date         : output.transaction_date,
                address_key_identifier_to: output.address_key_identifier,
                address_to               : output.address,
                is_stable                : output.is_stable
            };
            return database.firstShards((shardID) => {
                const transactionRepository = database.getRepository('transaction', shardID);
                return transactionRepository.getTransactionInput({
                    'transaction_id': data.transaction_id,
                    'input_position': 0
                });
            }).then(input => {
                if (!input) {
                    return Promise.reject('transaction_output_not_found');
                }
                data['address_key_identifier_from'] = input.address_key_identifier;
                data['address_from']                = input.address;
                return data;
            });
        }).then(data => {
            // get data
            return database.applyShards((shardID) => {
                const transactionRepository = database.getRepository('transaction', shardID);
                return transactionRepository.listTransactionOutputAttributes({
                    transaction_id   : data.transaction_id,
                    attribute_type_id: req.query.p2
                });
            }).then(attributes => {
                for (const attribute of attributes) {
                    attribute.value = JSON.parse(attribute.value);
                    if (attribute.attribute_type_id === this.normalizationRepository.get('transaction_output_metadata')) {
                        const file = _.find(attribute.value.file_list, file => file.hash === req.query.p3);
                        if (!file) {
                            return Promise.reject('file_not_found');
                        }
                        const key = file.key || file[wallet.defaultKeyIdentifier]?.key;
                        if (!key) {
                            return Promise.reject('decrypt_key_not_found');
                        }

                        const dataType = file.type || 'json';
                        return fileManager.decryptFile(data.address_key_identifier_from, data.transaction_date, data.transaction_id, file.hash, key, file.public)
                                          .then(fileData => {
                                              if (dataType === 'json') {
                                                  res.setHeader('content-type', 'application/json');
                                                  return res.send(JSON.parse(fileData.toString()));
                                              }

                                              if (file.mime_type) {
                                                  res.setHeader('content-type', file.mime_type);
                                              }
                                              res.send(fileData);
                                          });
                    }
                }
            });
        }).catch(e => res.send({
            api_status : 'fail',
            api_message: `unexpected generic api error: (${e})`
        }));
    }
}


export default new _Mh9QifTIESw5t1fa();
