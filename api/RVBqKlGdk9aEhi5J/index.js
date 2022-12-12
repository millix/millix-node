import Endpoint from '../endpoint';
import walletUtils from '../../core/wallet/wallet-utils';
import ntp from '../../core/ntp';
import config from '../../core/config/config';
import wallet from '../../core/wallet/wallet';
import async from 'async';
import database from '../../database/database';
import _ from 'lodash';


/**
 * api sign_transaction
 */

class _RVBqKlGdk9aEhi5J extends Endpoint {
    constructor() {
        super('RVBqKlGdk9aEhi5J');
    }

    /**
     * accepts an unsigned transaction payload and private keys to produce a
     * signed version of the transaction_payload_unsigned that is used by API
     * VnJIBrrM0KY3uQ9X to send a transaction
     * @param app
     * @param req (p0: transaction_payload_unsigned<required>, p1:
     *     private_key_hex<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        let transactionPayload;
        let privateKeyMap;
        let addressMap;

        if (req.method === 'GET') {
            if (!req.query.p0 || !req.query.p1 || !req.query.p2) {
                return res.status(400).send({
                    api_status : 'fail',
                    api_message: 'p0<transaction_payload_unsigned> and p1<private_key_hex> and p2<address_map> are required'
                });
            }
            else {
                transactionPayload = JSON.parse(req.query.p0);
                privateKeyMap      = JSON.parse(req.query.p1);
                addressMap         = JSON.parse(req.query.p2);
            }
        }
        else {
            if (!req.body.p0 || !req.body.p1 || !req.body.p2) {
                return res.status(400).send({
                    api_status : 'fail',
                    api_message: 'p0<transaction_payload_unsigned> and p1<private_key_hex> and p2<address_map> are required'
                });
            }
            else {
                transactionPayload = req.body.p0;
                privateKeyMap      = req.body.p1;
                addressMap         = req.body.p2;
            }
        }

        const transactionVersion = transactionPayload.transaction_version || config.WALLET_TRANSACTION_DEFAULT_VERSION;
        const transactionInputs  = transactionPayload.transaction_input_list;
        const transactionOutputs = transactionPayload.transaction_output_list;
        const outputFee          = transactionPayload.transaction_output_fee;
        const outputAttributes   = transactionPayload.transaction_output_attribute;

        let addressAttributeMap = {};

        (() => {

            if (!Array.isArray(transactionInputs) || !Array.isArray(transactionOutputs) || typeof (outputFee) !== 'object') {
                return Promise.reject('invalid request body');
            }

            for (let [address, publicKey] of Object.entries(addressMap)) {
                addressAttributeMap[address] = {
                    'key_public': publicKey
                };
            }

            if (transactionVersion === config.WALLET_TRANSACTION_REFRESH_VERSION) {
                if (!walletUtils.isValidRefreshTransaction(transactionInputs, transactionOutputs)) {
                    console.log(`[api ${this.endpoint}] Received invalid refresh transaction. Not going to sign.`);
                    return Promise.reject('invalid refresh transaction');
                }
            }
            return Promise.resolve();
        })().then(() => {
            return new Promise((resolve, reject) => {
                const amount       = _.sum(_.map(transactionOutputs, o => o.amount)) + outputFee.amount;
                let allocatedFunds = 0;
                async.eachSeries(transactionInputs, (input, callback) => {
                    database.firstShards((shardID) => {
                        const transactionRepository = database.getRepository('transaction', shardID);
                        return transactionRepository.getTransactionOutput({
                            '`transaction`.transaction_id': input.output_transaction_id,
                            'output_position'             : input.output_position,
                            'address_key_identifier'      : input.address_key_identifier
                        });
                    }).then(output => {
                        input.amount = output.amount;
                        allocatedFunds += output.amount;
                        callback();
                    }).catch((e) => {
                        callback(`transaction_output_not_found: ${JSON.stringify(input)}, ${e}`);
                    });
                }, (err) => {
                    if (err) {
                        return reject(err);
                    }
                    else if (amount !== allocatedFunds) {
                        return reject(`invalid_amount: allocated (${allocatedFunds}), spend (${amount})`);
                    }
                    resolve();
                });
            });
        }).then(() => {
            return wallet.proxyTransaction(transactionInputs, transactionOutputs, outputFee, addressAttributeMap, privateKeyMap, transactionVersion, false, outputAttributes)
                         .then(signedTransactionList => {
                             console.log(`[api ${this.endpoint}] Successfully signed transaction transaction. Tx: ${signedTransactionList.map(t => t.transaction_id).join(',')}`);
                             res.send(signedTransactionList);
                         });
        }).catch(e => {
            console.log(`[api ${this.endpoint}] error: ${e?.message || JSON.stringify(e)}`);
            res.send({
                api_status : 'fail',
                api_message: `unexpected generic api error: (${e?.message || e.cause || e})`
            });
        });
    }
}


export default new _RVBqKlGdk9aEhi5J();
