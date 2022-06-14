import Endpoint from '../endpoint';
import mutex from '../../core/mutex';
import _ from 'lodash';
import fileManager from '../../core/storage/file-manager';
import database from '../../database/database';
import walletUtils from '../../core/wallet/wallet-utils';
import base58 from 'bs58';
import busboy from 'busboy';


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
                const contentType = req.headers['Content-Type'];
                if (contentType === 'multipart/form-data') {
                    let transactionPartialPayload;
                    let transactionData;
                    const bb = busboy({headers: req.headers});
                    bb.on('file', (name, file, info) => {
                        const {
                                  filename,
                                  encoding,
                                  mimeType
                              } = info;
                        console.log(
                            `File [${name}]: filename: %j, encoding: %j, mimeType: %j`,
                            filename,
                            encoding,
                            mimeType
                        );

                        const buffers = [];
                        file.on('data', (data) => {
                            console.log(`File [${name}] got ${data.length} bytes`);
                            buffers.push(data);
                        }).on('close', () => {
                            transactionData = Buffer.concat(buffers);
                            console.log(`File [${name}] done: size ${transactionData.length}`);
                        });
                    });

                    bb.on('field', (name, val) => {
                        console.log(`Field [${name}]: value: %j`, val);
                        if (name === 'p0') {
                            transactionPartialPayload = JSON.parse(val);
                        }
                    });

                    bb.on('close', () => {
                        console.log('Done parsing form!');
                        if (transactionData === undefined || transactionPartialPayload === undefined) {
                            return reject({
                                api_status : 'fail',
                                api_message: 'p0<transaction_output_payload> is required'
                            });
                        }
                        transactionPartialPayload.transaction_data = transactionData;
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
                        || !_.isString(transactionPartialPayload.transaction_data_type)) {
                        return res.send({
                            api_status : 'fail',
                            api_message: `invalid transaction: must contain transaction_output_list(type array), transaction_output_fee (type object), transaction_data (type object) and transaction_data_type (string)`
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
                        const dataType = transactionPartialPayload.transaction_data_type;
                        let buffer;
                        if (dataType === 'json' || dataType === 'tangled_messenger') {
                            buffer = Buffer.from(JSON.stringify(transactionPartialPayload.transaction_data));
                        }
                        else if (dataType === 'binary' || dataType === 'tangled_nft') {
                            buffer = transactionPartialPayload.transaction_data;
                        }
                        else {
                            unlock();
                            return res.send({
                                api_status : 'fail',
                                api_message: `invalid transaction data type: must contain a valid transaction_data_type ('json' | 'binary' | 'tangled_messenger' | 'tangled_nft')`
                            });
                        }

                        const fileList = [
                            {
                                buffer,
                                name  : `${Date.now()}`,
                                size  : buffer.length,
                                type  : dataType,
                                public: false
                            }
                        ];

                        transactionPartialPayload.transaction_output_list.forEach(output => {
                            if (output.address_version.charAt(1) === 'b') {
                                // use default address version
                                output.address_version    = this.addressRepository.getDefaultAddressVersion().version;
                                // convert public key to address
                                output.address_public_key = output.address_base;
                                output.address_base       = walletUtils.getAddressFromPublicKey(base58.decode(output.address_public_key));
                            }
                        });

                        fileManager.createTransactionWithFileList(fileList, transactionPartialPayload.transaction_output_list, transactionPartialPayload.transaction_output_fee, transactionPartialPayload.transaction_output_attribute)
                                   .then(transaction => {
                                       unlock();
                                       res.send({
                                           api_status : 'success',
                                           transaction: transaction.transaction_list
                                       });
                                   })
                                   .catch(e => {
                                       console.log(`[api ${this.endpoint}] error: ${e}`);
                                       unlock();
                                       res.send({
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
}


export default new _XQmpDjEVF691r2gX();
