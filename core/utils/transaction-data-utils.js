import async from 'async';
import database from '../../database/database';
import _ from 'lodash';
import fileManager from '../storage/file-manager';
import wallet from '../wallet/wallet';

function processOutputList(outputList, attributeTypeId, orderBy, limit, shardID, dataType) {
    const normalizationRepository = database.getRepository('normalization');

    const data = outputList.map(output => ({
        transaction_id           : output.transaction_id,
        transaction_date         : output.transaction_date,
        transaction_create_date  : output.transaction_create_date,
        amount                   : output.amount,
        address_key_identifier_to: output.address_key_identifier,
        address_to               : output.address,
        output_position          : output.output_position,
        is_stable                : output.is_stable,
        is_spent                 : output.is_spent,
        is_double_spend          : output.is_double_spend
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
    })
        .then(data => {
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

            return new Promise((resolve) => {
                async.eachSeries(data, (transaction, callback) => {
                    database.applyShards((shardID) => {
                        const transactionRepository = database.getRepository('transaction', shardID);
                        return transactionRepository.listTransactionOutputAttributes({
                            transaction_id   : transaction.transaction_id,
                            attribute_type_id: attributeTypeId
                        });
                    }, orderBy, limit, shardID)
                            .then(attributes => {
                                async.eachSeries(attributes, (attribute, attributeCallback) => {
                                    attribute.value = JSON.parse(attribute.value);
                                    if (attribute.attribute_type_id === normalizationRepository.get('transaction_output_metadata')) {
                                        if (!attribute.value.file_list || attribute.value.file_list.length === 0) {
                                            dataToRemove.add(transaction);
                                            return attributeCallback();
                                        }

                                        const attributeFileData = {};
                                        const attributeFileKey  = {};
                                        async.eachSeries(attribute.value.file_list, (file, fileReadCallback) => {
                                            fileManager.getKeyByTransactionAndFileHash(transaction.transaction_id, attributeTypeId, file.hash).then(transactionOutputKey => {
                                                attributeFileKey[file.hash] = transactionOutputKey;
                                            }).catch(_ => _);

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
                                                           attributeFileData[file.hash] = JSON.parse(fileData.toString());
                                                           fileReadCallback();
                                                       }).catch(() => fileReadCallback());
                                        }, () => {
                                            attributeCallback();
                                        });
                                        attribute.file_data          = attributeFileData;
                                        attribute.attribute_file_key = attributeFileKey;
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

                    resolve(data);
                });
            });
        });
}

export default {
    processOutputList
};
