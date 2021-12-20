import Endpoint from '../endpoint';
import walletUtils from '../../core/wallet/wallet-utils';
import peer from '../../net/peer';
import database from '../../database/database';
import _ from 'lodash';
import network from '../../net/network';
import base58 from 'bs58';
import wallet from '../../core/wallet/wallet';
import walletTransactionConsensus from '../../core/wallet/wallet-transaction-consensus';


/**
 * api send_transaction
 */
class _VnJIBrrM0KY3uQ9X extends Endpoint {
    constructor() {
        super('VnJIBrrM0KY3uQ9X');
    }

    _getProxyTimeLimit(value) {
        let proxyTimeLimit;
        try {
            proxyTimeLimit = parseInt(value);
            return proxyTimeLimit > 0 ? proxyTimeLimit : 30000;
        }catch (e) {
        }
        return 30000;
    }

    /**
     * submits a new transaction with a transaction payload, containing inputs,
     * signatures, outputs and amounts to the node. this API is generally used
     * in conjunction with the output from API RVBqKlGdk9aEhi5J
     * (sign_transaction)
     * @param app
     * @param req (p0: transaction_payload_signed<require>, p1:proxy_time_limit<default 30000ms>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        let transactionList, proxyTimeLimit;
        console.log(`[api ${this.endpoint}] request to send transaction`);
        if (req.method === 'GET') {
            if (!req.query.p0) {
                return res.status(400).send({
                    api_status : 'fail',
                    api_message: 'p0<transaction_payload_signed> is required'
                });
            }
            else {
                transactionList = JSON.parse(req.query.p0);
            }

            proxyTimeLimit = this._getProxyTimeLimit(req.query.p1);
        }
        else {
            if (!req.body.p0) {
                return res.status(400).send({
                    api_status : 'fail',
                    api_message: 'p0<transaction_payload_signed> is required'
                });
            }
            else {
                transactionList = req.body.p0;
            }
            proxyTimeLimit = this._getProxyTimeLimit(req.body.p1);
        }


        try {
            console.log(`[api ${this.endpoint}] request to send Tx: ${transactionList.map(t=>t.transaction_id).join(",")}`);
            const transactionRepository = database.getRepository('transaction');
            let pipeline                = Promise.resolve(true);
            transactionList.forEach(transaction => pipeline = pipeline.then(valid => valid ? walletUtils.verifyTransaction(transaction) : false));
            pipeline.then(valid => {
                if (!valid) {
                    return Promise.reject('transaction_payload_invalid');
                }
                const proxyWS = network.getNodeSocket(transactionList[0].node_id_proxy);
                if (!proxyWS) {
                    return Promise.reject('proxy_unavailable');
                }

                console.log(`[api ${this.endpoint}] transaction sent to proxy ${proxyWS.nodeID} Tx: ${transactionList.map(t=>t.transaction_id).join(",")} | proxy_time_limit: ${proxyTimeLimit}`);
                return peer.transactionProxy(transactionList, proxyTimeLimit, proxyWS)
                           .then(transactionList => {
                               // store the transaction
                               let pipeline = Promise.resolve();
                               transactionList.forEach(transaction => {
                                   console.log(`[api ${this.endpoint}] Storing transaction submitted on API. Hash: ${transaction.transaction_id}`);
                                   const dbTransaction            = _.cloneDeep(transaction);
                                   dbTransaction.transaction_date = new Date(dbTransaction.transaction_date * 1000).toISOString();
                                   pipeline                       = pipeline.then(() => transactionRepository.addTransactionFromObject(dbTransaction, wallet.transactionHasKeyIdentifier(dbTransaction)));
                               });
                               return pipeline.then(() => transactionList);
                           })
                           .then(transactionList => {
                               // register first
                               // address to the
                               // dht for receiving
                               // proxy fees
                               const transaction = transactionList[0];
                               const address     = _.pick(transaction.transaction_input_list[0], [
                                   'address_base',
                                   'address_version',
                                   'address_key_identifier'
                               ]);
                               let publicKeyBase58;
                               for (let signature of transaction.transaction_signature_list) {
                                   if (signature.address_base === address.address_base) {
                                       publicKeyBase58 = signature.address_attribute.key_public;
                                       break;
                                   }
                               }
                               if (publicKeyBase58) {
                                   const keychainRepository = database.getRepository('keychain');
                                   keychainRepository.getAddress(address.address_base + address.address_version + address.address_key_identifier)
                                                     .then(address => {
                                                         const walletID           = address.wallet_id;
                                                         const extendedPrivateKey = wallet.getActiveWallets()[walletID];
                                                         if (!extendedPrivateKey) {
                                                             return;
                                                         }

                                                         const privateKey = walletUtils.derivePrivateKey(extendedPrivateKey, address.is_change, address.address_position);
                                                         network.addAddressToDHT(address, base58.decode(publicKeyBase58).slice(1, 33), privateKey);
                                                     }).catch(_ => _);
                               }
                               return transactionList;
                           })
                           .then(transactionList => {
                               transactionList.forEach(transaction => {
                                   console.log(`[api ${this.endpoint}] successfully stored transaction submitted on API. Hash: ${transaction.transaction_id}. Submitting to peers`);
                                   peer.transactionSend(transaction);
                               });
                               setTimeout(() => walletTransactionConsensus.doValidateTransaction(), 5000);
                               res.send({api_status: 'success'});
                           });
            }).catch(e => {
                console.log(`[api ${this.endpoint}] error: ${e}`);
                res.send({
                    api_status : 'fail',
                    api_message: e
                });
            });
        }
        catch (e) {
            console.log(`[api ${this.endpoint}] error: ${e}`);
            return res.send({
                api_status : 'fail',
                api_message: `unexpected generic api error: (${e})`
            });
        }
    }
}


export default new _VnJIBrrM0KY3uQ9X();
