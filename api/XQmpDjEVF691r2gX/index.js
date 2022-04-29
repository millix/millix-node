import Endpoint from '../endpoint';
import mutex from '../../core/mutex';
import _ from 'lodash';
import fileManager from '../../core/storage/file-manager';
import database from '../../database/database';
import walletUtils from '../../core/wallet/wallet-utils';
import base58 from 'bs58';


/**
 * api send_transaction_with_data_from_wallet
 */
class _XQmpDjEVF691r2gX extends Endpoint {
    constructor() {
        super('XQmpDjEVF691r2gX');
        this.addressRepository = database.getRepository('address');
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
        let transactionPartialPayload;

        if (req.method === 'GET') {
            if (!req.query.p0) {
                return res.status(400).send({
                    api_status : 'fail',
                    api_message: 'p0<transaction_output_payload> is required'
                });
            }
            else {
                transactionPartialPayload = JSON.parse(req.query.p0);
            }
        }
        else {
            if (!req.body.p0) {
                return res.status(400).send({
                    api_status : 'fail',
                    api_message: 'p0<transaction_output_payload> is required'
                });
            }
            else {
                transactionPartialPayload = req.body.p0;
            }
        }


        try {
            if (!_.isArray(transactionPartialPayload.transaction_output_list)
                || !_.isObject(transactionPartialPayload.transaction_output_fee)
                || !_.isObject(transactionPartialPayload.transaction_data)) {
                return res.send({
                    api_status : 'fail',
                    api_message: `invalid transaction: must contain transaction_output_list(type array), transaction_output_fee (type object) and transaction_data (type object)`
                });
            }
            mutex.lock(['submit_transaction'], (unlock) => {
                const buffer   = Buffer.from(JSON.stringify(transactionPartialPayload.transaction_data));
                const fileList = [
                    {
                        buffer,
                        name  : `${Date.now()}`,
                        size  : buffer.length,
                        type  : 'tangled_messenger',
                        public: false
                    }
                ];

                transactionPartialPayload.transaction_output_list.forEach(output => {
                    if (output.address_version.charAt(1) === 'b') {
                        // use default address version
                        output.address_version = this.addressRepository.getDefaultAddressVersion().version;
                        // convert public key to address
                        output.address_public_key = output.address_base;
                        output.address_base = walletUtils.getAddressFromPublicKey(base58.decode(output.address_public_key))
                    }
                });

                fileManager.createTransactionWithFileList(fileList, transactionPartialPayload.transaction_output_list, transactionPartialPayload.transaction_output_fee)
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
    }
}


export default new _XQmpDjEVF691r2gX();
