import Endpoint from '../endpoint';
import walletUtils from '../../core/wallet/wallet-utils';
import ntp from '../../core/ntp';
import config from '../../core/config/config';


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
                    status : 'fail',
                    message: 'p0<transaction_payload_unsigned> and p1<private_key_hex> and p2<address_map> are required'
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
                    status : 'fail',
                    message: 'p0<transaction_payload_unsigned> and p1<private_key_hex> and p2<address_map> are required'
                });
            }
            else {
                transactionPayload = req.body.p0;
                privateKeyMap      = req.body.p1;
                addressMap         = req.body.p2;
            }
        }

        try {
            ntp.getTime().then(time => {
                const transactionDate    = new Date(Math.floor(time.now.getTime() / 1000) * 1000);
                const transactionVersion = transactionPayload.transaction_version;
                const transactionInputs  = transactionPayload.transaction_input_list;
                const transactionOutputs = transactionPayload.transaction_output_list;

                let addressAttributeMap = {};

                for (let [address, publicKey] of Object.entries(addressMap)) {
                    addressAttributeMap[address] = {
                        "key_public": publicKey
                    }
                }

                new Promise((resolve) => {
                    if (transactionVersion === config.WALLET_TRANSACTION_REFRESH_VERSION) {
                        if (!(walletUtils.isValidRefreshTransaction(transactionInputs, transactionOutputs))) {
                            console.log(`[api ${this.endpoint}] Received invalid refresh transaction. Not going to sign.`);

                            res.send({
                                status : 'fail',
                                message: 'Invalid refresh transaction'
                            });
                            resolve(false);
                        }
                        else {
                            resolve(true);
                        }
                    }
                    else {
                        walletUtils.isConsumingExpiredOutputs(transactionInputs, transactionDate)
                                   .then(isConsuming => {
                                       if (isConsuming) {
                                           console.log(`[api ${this.endpoint}] Transaction consuming expired transaction outputs. Not going to sign.`);

                                           res.send({
                                               status : 'fail',
                                               message: 'Consuming transactions that have expired'
                                           });
                                       }
                                       resolve(!isConsuming);
                                   });
                    }
                })
                    .then(shouldSign => {
                        if (shouldSign) {
                            walletUtils.signTransaction(transactionInputs, transactionOutputs, addressAttributeMap, privateKeyMap, transactionDate, transactionVersion)
                                       .then(signedTransaction => {
                                           console.log(`[api ${this.endpoint}] Successfully signed transaction transaction.`);
                                           res.send(signedTransaction);
                                       })
                                       .catch(e => {
                                           console.log(`[api ${this.endpoint}] Failed to sign transaction. Error: ${e}`);
                                           res.send({
                                               status : 'fail',
                                               message: e.message
                                           });
                                       });
                        }
                    });
            });
        }
        catch (e) {
            console.log(`[api ${this.endpoint} error: ${e}]`);
            return res.send({
                status : 'fail',
                message: 'transaction_sign_error'
            });
        }
    }
}


export default new _RVBqKlGdk9aEhi5J();
