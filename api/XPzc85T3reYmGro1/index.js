import Endpoint from '../endpoint';
import walletUtils from '../../core/wallet/wallet-utils';
import peer from '../../net/peer';
import database from '../../database/database';
import mutex from '../../core/mutex';
import _ from 'lodash';
import network from '../../net/network';
import base58 from 'bs58';
import wallet from '../../core/wallet/wallet';
import walletTransactionConsensus from '../../core/wallet/wallet-transaction-consensus';
import config from '../../core/config/config';


/**
 * api send_transaction_from_wallet
 */
class _XPzc85T3reYmGro1 extends Endpoint {
    constructor() {
        super('XPzc85T3reYmGro1');
        this.addressRepository = database.getRepository('address');
    }

    /**
     * submits a new transaction from the active wallet, specifying the outputs
     * and amounts to the node. this API builds the tx payload and submits it
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
                || !_.isObject(transactionPartialPayload.transaction_output_fee)) {
                return res.send({
                    api_status : 'fail',
                    api_message: `invalid transaction: must contain transaction_output_list(type array) and transaction_output_fee (type object) `
                });
            }

            if (transactionPartialPayload.version === config.BRIDGE_TRANSACTION_VERSION_MINT) {
                let bridgeAddress;
                try {
                    if (!config.BRIDGE_ADDRESS) {
                        throw Error('the bridge address is not configured in your node');
                    }
                    bridgeAddress           = this.addressRepository.getAddressComponent(config.BRIDGE_ADDRESS);
                    const destinationOutput = transactionPartialPayload.transaction_output_list[0];
                    const bridgeFeeOutput   = transactionPartialPayload.transaction_output_list[1];

                    if (destinationOutput) {
                        destinationOutput['address_base']           = bridgeAddress.address;
                        destinationOutput['address_version']        = bridgeAddress.version;
                        destinationOutput['address_key_identifier'] = bridgeAddress.identifier;
                    }

                    if (bridgeFeeOutput) {
                        bridgeFeeOutput['address_base']           = bridgeAddress.address;
                        bridgeFeeOutput['address_version']        = this.addressRepository.getDefaultAddressVersion().version;
                        bridgeFeeOutput['address_key_identifier'] = bridgeAddress.identifier;
                    }

                }
                catch (e) {
                    return res.send({
                        api_status : 'fail',
                        api_message: `invalid bridge address: ${e}`
                    });
                }
            }

            mutex.lock(['submit_transaction'], (unlock) => {
                wallet.addTransaction(transactionPartialPayload.transaction_output_list, transactionPartialPayload.transaction_output_fee, null, transactionPartialPayload.version, transactionPartialPayload.transaction_output_attribute)
                      .then(transaction => {
                          unlock();
                          res.send({
                              api_status: 'success',
                              transaction
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


export default new _XPzc85T3reYmGro1();
