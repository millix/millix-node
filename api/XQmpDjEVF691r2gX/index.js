import Endpoint from '../endpoint';
import mutex from '../../core/mutex';
import _ from 'lodash';
import fileManager from '../../core/storage/file-manager';
import database from '../../database/database';
import walletUtils from '../../core/wallet/wallet-utils';
import config from '../../core/config/config';
import base58 from 'bs58';
import busboy from 'busboy';
import wallet from '../../core/wallet/wallet';
import cache from '../../core/cache';


/**
 * api send_transaction_with_data_from_wallet
 */
class _XQmpDjEVF691r2gX extends Endpoint {
    constructor() {
        super('XQmpDjEVF691r2gX');
        this.addressRepository = database.getRepository('address');
    }

    getRequestData(req) {
        return new Promise((resolve, reject) => {
            if (req.method === 'GET' && req.query.p0) {
                return resolve(JSON.parse(req.query.p0));
            }

            if (req.method === 'POST') {
                const contentType = req.headers['content-type'];
                if (contentType && contentType.startsWith('multipart/form-data')) {
                    let transactionPartialPayload;
                    let transactionData;
                    let transactionDataMimeType;
                    const bb = busboy({headers: req.headers});
                    bb.on('file', (name, file, info) => {
                        transactionDataMimeType = info.mimeType;
                        const buffers           = [];
                        file.on('data', (data) => {
                            buffers.push(data);
                        }).on('close', () => {
                            transactionData = Buffer.concat(buffers);
                        });
                    });

                    bb.on('field', (name, val) => {
                        if (name === 'p0') {
                            transactionPartialPayload = JSON.parse(val);
                        }
                    });

                    bb.on('close', () => {
                        if (transactionData === undefined || transactionPartialPayload === undefined) {
                            return reject({
                                api_status : 'fail',
                                api_message: 'p0<transaction_output_payload> is required'
                            });
                        }
                        transactionPartialPayload.transaction_data           = transactionData;
                        transactionPartialPayload.transaction_data_mime_type = transactionDataMimeType;
                        resolve(transactionPartialPayload);
                    });

                    req.pipe(bb);
                    return;
                }

                if (req.body.p0) {
                    return resolve(req.body.p0);
                }

            }

            return reject({
                api_status : 'fail',
                api_message: 'p0<transaction_output_payload> is required'
            });
        });
    }

    /**
     * submits a new transaction with data on dag from the active wallet,
     * specifying the outputs and amounts to the node. this API builds the tx
     * payload and submits it
     * @param app
     * @param req (p0: transaction_output_payload<require>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        this.getRequestData(req)
            .then(transactionPartialPayload => {
                try {
                    if (!_.isArray(transactionPartialPayload.transaction_output_list)
                        || !_.isObject(transactionPartialPayload.transaction_output_fee)
                        || !_.isObject(transactionPartialPayload.transaction_data)
                        || !_.isString(transactionPartialPayload.transaction_data_type)
                        || (transactionPartialPayload.transaction_data_meta && !_.isObject(transactionPartialPayload.transaction_data_meta))) {
                        return res.send({
                            api_status : 'fail',
                            api_message: `invalid transaction: must contain transaction_output_list(type array), transaction_output_fee (type object), transaction_data (type object), transaction_data_type (type string) and transaction_data_meta (type object)`
                        });
                    }

                    if (transactionPartialPayload.transaction_output_attribute) {
                        if (!_.isObject(transactionPartialPayload.transaction_output_attribute)) {
                            return res.send({
                                api_status : 'fail',
                                api_message: `invalid transaction: must contain a valid transaction_output_attribute (type object)`
                            });
                        }
                        else {
                            const size = JSON.stringify(transactionPartialPayload.transaction_output_attribute).length;
                            if (size > 2048) {
                                return res.send({
                                    api_status : 'fail',
                                    api_message: `invalid transaction: must contain a valid transaction_output_attribute (max size = 2048 | current size = ${size})`
                                });
                            }
                        }
                    }


                    mutex.lock(['submit_transaction'], (unlock) => {
                        this.getTransactionBuffer(transactionPartialPayload)
                            .then(([buffer, metadataBuffer]) => this.getTransactionOutputToSpend(transactionPartialPayload).then(srcOutputs => ([
                                buffer,
                                metadataBuffer,
                                srcOutputs
                            ])))
                            .then(([buffer, metadataBuffer, srcOutputs]) => {

                                if (!buffer) {
                                    return Promise.reject('invalid buffer');
                                }

                                const dataType = transactionPartialPayload.transaction_data_type;
                                const mimeType = transactionPartialPayload.transaction_data_mime_type;

                                if (dataType === 'transaction') {
                                    // burn asset or nft
                                    return wallet.addTransaction(transactionPartialPayload.transaction_output_list, transactionPartialPayload.transaction_output_fee, srcOutputs, config.MODE_TEST_NETWORK ? 'la3l' : '0a30', transactionPartialPayload.transaction_output_attribute)
                                                 .then(transaction => {
                                                     unlock();
                                                     res.send({
                                                         api_status: 'success',
                                                         transaction
                                                     });
                                                 });
                                }

                                const file = {
                                    buffer,
                                    name  : `${Date.now()}`,
                                    size  : buffer.length,
                                    type  : dataType,
                                    public: false
                                };

                                if (mimeType) {
                                    file['mime_type'] = mimeType;
                                }

                                const fileList = [file];

                                if (metadataBuffer) {
                                    const metaFile = {
                                        buffer: metadataBuffer,
                                        name  : `${file.name}_meta`,
                                        size  : metadataBuffer.length,
                                        type  : `${file.type}_meta`,
                                        public: false
                                    };
                                    fileList.push(metaFile);
                                }

                                transactionPartialPayload.transaction_output_list.forEach(output => {
                                    if (output.address_version.charAt(1) === 'b') {
                                        // use default address version
                                        output.address_version    = this.addressRepository.getDefaultAddressVersion().version;
                                        // convert public key to address
                                        output.address_public_key = output.address_base;
                                        output.address_base       = walletUtils.getAddressFromPublicKey(base58.decode(output.address_public_key));
                                    }

                                    if (dataType === 'tangled_nft') {
                                        output.address_version = config.ADDRESS_VERSION_NFT;
                                    }
                                });

                                return fileManager.createTransactionWithFileList(fileList, transactionPartialPayload.transaction_output_list, transactionPartialPayload.transaction_output_fee, srcOutputs, transactionPartialPayload.transaction_output_attribute)
                                                  .then(transaction => {
                                                      unlock();
                                                      res.send({
                                                          api_status : 'success',
                                                          transaction: transaction.transaction_list
                                                      });
                                                  });
                            })
                            .catch((e) => {
                                console.log(`[api ${this.endpoint}] error: ${e}`);
                                unlock();
                                return res.send({
                                    api_status : 'fail',
                                    api_message: e
                                });
                            });
                    });
                }
                catch (e) {
                    console.log(`[api ${this.endpoint}] error: ${e}`);
                    res.send({
                        api_status : 'fail',
                        api_message: `unexpected generic api error: (${e})`
                    });
                }
            })
            .catch(err => res.send(err));
    }

    getTransactionBuffer(transactionPartialPayload) {
        let dataType = transactionPartialPayload.transaction_data_type;

        let metadataBuffer = undefined;

        if (dataType === 'json' || dataType === 'tangled_messenger') {
            if (transactionPartialPayload.transaction_data_meta) {
                metadataBuffer = Buffer.from(JSON.stringify(transactionPartialPayload.transaction_data_meta));
            }

            return Promise.resolve([
                Buffer.from(JSON.stringify(transactionPartialPayload.transaction_data)),
                metadataBuffer
            ]);
        }

        if (dataType === 'binary' || dataType === 'tangled_nft' || dataType === 'tangled_asset' || dataType === 'transaction') {
            const parentDataType = transactionPartialPayload.transaction_data_type_parent || dataType;
            if ((parentDataType === 'binary' || parentDataType === 'tangled_nft') && transactionPartialPayload.transaction_output_attribute.parent_transaction_id) {
                return fileManager.getBufferByTransactionAndFileHash(transactionPartialPayload.transaction_output_attribute.parent_transaction_id,
                    wallet.defaultKeyIdentifier,
                    transactionPartialPayload.transaction_data.attribute_type_id,
                    transactionPartialPayload.transaction_data.file_hash)
                                  .then(data => {
                                      transactionPartialPayload.transaction_data_mime_type = data.mime_type;
                                      return fileManager.getBufferMetaByTransactionAndFileHash(transactionPartialPayload.transaction_output_attribute.parent_transaction_id,
                                          wallet.defaultKeyIdentifier,
                                          transactionPartialPayload.transaction_data.attribute_type_id,
                                          transactionPartialPayload.transaction_data.file_hash)
                                                        .then(metadataBuffer => [
                                                            data.file_data,
                                                            metadataBuffer?.file_data
                                                        ])
                                                        .catch(e => {
                                                            if (e === 'file_meta_not_found') {
                                                                return [
                                                                    data.file_data,
                                                                    undefined
                                                                ];
                                                            }
                                                            return Promise.reject(e);
                                                        });
                                  });
            }

            if (transactionPartialPayload.transaction_data_meta) {
                metadataBuffer = Buffer.from(JSON.stringify(transactionPartialPayload.transaction_data_meta));
            }

            return Promise.resolve([
                transactionPartialPayload.transaction_data,
                metadataBuffer
            ]);
        }

        return Promise.reject(`invalid transaction data type: must contain a valid transaction_data_type ('json' | 'binary' | 'tangled_messenger' | 'tangled_nft')`);
    }

    getTransactionOutputToSpend(transactionPartialPayload) {
        const dataType = transactionPartialPayload.transaction_data_type_parent || transactionPartialPayload.transaction_data_type;
        if (dataType === 'tangled_nft' && transactionPartialPayload.transaction_output_attribute.parent_transaction_id) {
            return database.applyShards(shardID => {
                const transactionRepository = database.getRepository('transaction', shardID);
                return transactionRepository.listTransactionOutput({
                    '`transaction`.transaction_id': transactionPartialPayload.transaction_output_attribute.parent_transaction_id,
                    'address_like'                : `%${config.ADDRESS_VERSION_NFT}%`,
                    'address_key_identifier'      : wallet.defaultKeyIdentifier,
                    'transaction_output.is_stable': 1,
                    'is_spent'                    : 0
                });
            }).then(nftOutputList => {
                if (nftOutputList.length === 0) {
                    return Promise.reject({error: 'nft output not available'});
                }

                // get output to pay fees
                return database.applyShards((shardID) => {
                    const transactionRepository = database.getRepository('transaction', shardID);
                    return transactionRepository.getFreeOutput(wallet.defaultKeyIdentifier);
                }).then((outputs) => {
                    return wallet.updateTransactionOutputWithAddressInformation(_.filter(outputs, output => !cache.getCacheItem('wallet', `is_spend_${output.transaction_id}_${output.output_position}`)));
                }).then((outputs) => {
                    if (!outputs || (transactionPartialPayload.transaction_data_type === 'tangled_nft' && outputs.length === 0)) {
                        return Promise.reject({
                            error: 'insufficient_balance',
                            data : {balance_stable: 0}
                        });
                    }
                    outputs = _.orderBy(outputs, ['amount'], ['asc']);

                    const transactionAmount = transactionPartialPayload.transaction_output_fee.amount;
                    let remainingAmount     = transactionAmount;
                    const outputsToUse      = [nftOutputList[0]];

                    if (outputs.length === 0) {
                        transactionPartialPayload.transaction_output_list[0].amount -= transactionPartialPayload.transaction_output_fee.amount;
                        remainingAmount -= nftOutputList[0].amount;
                    }

                    for (let i = 0; i < outputs.length && remainingAmount > 0; i++) {

                        if (i + 1 === config.TRANSACTION_INPUT_MAX) { /* we cannot add more inputs and still we did not aggregate the required amount for the transaction */
                            return Promise.reject({
                                error: 'transaction_input_max_error',
                                data : {amount_max: transactionAmount - remainingAmount}
                            });
                        }

                        let output = outputs[i];
                        remainingAmount -= output.amount;
                        outputsToUse.push(output);
                    }

                    if (remainingAmount > 0) {
                        return Promise.reject({
                            error: 'insufficient_balance',
                            data : {balance_stable: transactionAmount - remainingAmount}
                        });
                    }

                    return outputsToUse;
                });
            });
        }
        return Promise.resolve(null);
    }
}


export default new _XQmpDjEVF691r2gX();
