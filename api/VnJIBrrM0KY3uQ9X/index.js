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
import {SHARD_ZERO_NAME} from '../../core/config/config';


/**
 * api send_transaction
 */
class _VnJIBrrM0KY3uQ9X extends Endpoint {
    constructor() {
        super('VnJIBrrM0KY3uQ9X');
    }

    /**
     * submits a new transaction with a transaction payload, containing inputs,
     * signatures, outputs and amounts to the node. this API is generally used
     * in conjunction with the output from API RVBqKlGdk9aEhi5J
     * (sign_transaction)
     * @param app
     * @param req (p0: transaction_payload_signed<require>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        let transactionList;

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
        }


        try {
            const transactionRepository = database.getRepository('transaction');
            mutex.lock([`transaction_${SHARD_ZERO_NAME}`], (unlock) => {
                let pipeline                = Promise.resolve(true);
                transactionList.forEach(transaction => pipeline = pipeline.then(valid => valid ? walletUtils.verifyTransaction(transaction) : false));
                pipeline.then(valid => {
                    if (!valid) {
                        return Promise.reject('bad transaction payload');
                    }
                    const proxyWS = network.getNodeSocket(transactionList[0].node_id_proxy);
                    if (!proxyWS) {
                        return Promise.reject('proxy unavailable');
                    }

                    return peer.transactionProxy(transactionList, proxyWS)
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
                                   res.send({api_status: 'success'});
                                   setTimeout(() => walletTransactionConsensus.doValidateTransaction(), 5000);
                                   unlock();
                               });
                }).catch(e => {
                    console.log(`[api ${this.endpoint}] error: ${e}`);
                    res.send({
                        api_status : 'fail',
                        api_message: `unexpected generic api error: (${e})`
                    });
                    unlock();
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
