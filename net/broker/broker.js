import _ from 'lodash';
import https from 'https';
import network from '../network';
import config from '../../core/config/config';
import database from '../../database/database';
import wallet from '../../core/wallet/wallet';
import walletUtils from '../../core/wallet/wallet-utils';
import cloudPass, {CLOUD_PASS_VERSION} from './cloud-pass';
import cloudVersion from '../cloud-version';
import {readJSONBody, sendJSON} from './node-request';
import eventBus from '../../core/event-bus';
import mutex from '../../core/mutex';
import ntp from '../../core/ntp';
import task from '../../core/task';
import console from '../../core/console';

const BODY_SIZE_MAX = 64 * 1024;


/**
 * the broker service: sells passes and pays exit nodes from receipts.
 *
 * the broker is this node's wallet: its first address and key. it serves
 * https with the node certificate on NODE_PORT_BROKER and publishes a broker
 * offer (publish_cloud_offer with service broker) carrying its terms signed
 * by the broker key, so users and exit nodes find it from the offers.
 *
 * - POST /broker/certificate {funding_transaction_id, holder_public_key,
 *   signature}: once the payment of the pass price to the broker address is
 *   stable and its signed metadata names the holder key, returns the
 *   prepaid certificate (the same one for every request about that payment).
 * - POST /broker/piece {certificate_id, piece_index, signature}: returns the
 *   piece; pieces are issued in order.
 * - POST /broker/report {report}: an exit node's latest receipts, signed by
 *   its node key, with the address to pay.
 * - GET /broker/terms: the signed terms.
 *
 * every CLOUD_BROKER_PAYOUT_INTERVAL the broker pays each exit node what its
 * receipts earned at the pool rate and was not paid yet, once that reaches
 * CLOUD_BROKER_PAYOUT_AMOUNT_MIN. a certificate pays at most its data in
 * total: when exit nodes receipt more, the earliest receipts are paid first.
 * one transaction pays up to CLOUD_BROKER_PAYOUT_OUTPUT_MAX - 1 exit nodes;
 * the broker pays the fee and each exit node gets its full amount.
 */
class Broker {
    constructor() {
        this.server = null;
    }

    _now() {
        return Math.floor(ntp.now().getTime() / 1000);
    }

    /**
     * the broker key: this wallet's first key
     * @return {{private_key, public_key, address_base, address_version, address_key_identifier, address}}
     */
    getBrokerKey() {
        const extendedPrivateKey = wallet.getActiveWalletKey(wallet.getDefaultActiveWallet());
        if (!extendedPrivateKey) {
            throw Error('wallet_not_active');
        }
        const privateKey     = walletUtils.derivePrivateKey(extendedPrivateKey, 0, 0);
        const publicKey      = cloudPass.getPublicKey(privateKey);
        const addressBase    = cloudPass.getAddressBaseFromPublicKey(publicKey);
        const addressVersion = database.getRepository('address').getDefaultAddressVersion().version;
        return {
            private_key           : privateKey,
            public_key            : publicKey,
            address_base          : addressBase,
            address_version       : addressVersion,
            address_key_identifier: addressBase,
            address               : `${addressBase}${addressVersion}${addressBase}`
        };
    }

    getTerms() {
        const brokerKey = this.getBrokerKey();
        return cloudPass.signBrokerTerms({
            address         : brokerKey.address,
            public_key      : brokerKey.public_key,
            pass_price      : config.CLOUD_BROKER_PASS_PRICE,
            pass_data_bytes : config.CLOUD_BROKER_PASS_DATA_BYTES,
            pass_piece_bytes: config.CLOUD_BROKER_PASS_PIECE_BYTES,
            pass_duration   : config.CLOUD_BROKER_PASS_DURATION,
            pool_rate       : config.CLOUD_BROKER_POOL_RATE,
            payout_interval : config.CLOUD_BROKER_PAYOUT_INTERVAL
        }, network.nodeID, brokerKey.private_key);
    }

    /**
     * checks that the transaction paid the pass price to the broker for this
     * holder key and is stable
     */
    _verifyPassPayment(fundingTransactionID, holderPublicKey, brokerKey) {
        return database.firstShards(shardID => {
            return new Promise((resolve, reject) => database.getRepository('transaction', shardID)
                                                            .getTransactionObject(fundingTransactionID)
                                                            .then(transaction => transaction ? resolve(transaction) : reject())
                                                            .catch(reject));
        }).then(transaction => {
            if (!transaction) {
                wallet.requestTransactionFromNetwork(fundingTransactionID, {
                    priority        : 1,
                    dispatch_request: true
                });
                return Promise.reject('payment_not_found');
            }

            const version       = transaction.version;
            const versionNumber = parseInt(version.substring(2, version.length - 1));
            const passMetadata  = transaction.transaction_output_attribute?.transaction_output_metadata?.cloud_pass;
            // the metadata naming the holder key is signed from transaction
            // version 3 only
            if (version.charAt(1) !== 'a' || !(versionNumber >= 3) || !_.isPlainObject(passMetadata) ||
                passMetadata.holder_public_key !== holderPublicKey || passMetadata.broker_address !== brokerKey.address) {
                return Promise.reject('payment_not_for_this_pass');
            }

            return database.applyShards(shardID => database.getRepository('transaction', shardID)
                                                           .listTransactionOutput({
                                                               'transaction_output.transaction_id': fundingTransactionID,
                                                               'transaction_output.address'       : brokerKey.address
                                                           }))
                           .then(outputList => {
                               outputList = _.uniqBy(outputList, 'output_position');
                               if (_.some(outputList, output => output.is_double_spend === 1 || output.status === 3 || output.transaction_status === 3)) {
                                   return Promise.reject('payment_invalid');
                               }
                               if (_.sum(_.map(outputList, output => output.amount)) < config.CLOUD_BROKER_PASS_PRICE) {
                                   return Promise.reject('payment_too_small');
                               }
                               if (!_.every(outputList, output => output.is_stable === 1)) {
                                   return Promise.reject('payment_not_stable');
                               }
                               return transaction;
                           });
        });
    }

    /**
     * the prepaid certificate for a payment, issued once
     */
    issueCertificate(body) {
        const fundingTransactionID = body?.funding_transaction_id;
        const holderPublicKey      = body?.holder_public_key;
        if (typeof fundingTransactionID !== 'string' || typeof holderPublicKey !== 'string' ||
            !cloudPass.isValidHolderMessage({
                funding_transaction_id: fundingTransactionID,
                broker_node_id        : network.nodeID
            }, body.signature, holderPublicKey)) {
            return Promise.reject('certificate_request_invalid');
        }

        const brokerKey            = this.getBrokerKey();
        const cloudBrokerRepository = database.getRepository('cloud_broker');
        return new Promise((resolve, reject) => {
            mutex.lock([`cloud_broker_certificate_${fundingTransactionID}`], unlock => {
                cloudBrokerRepository.getCertificateByFundingTransaction(fundingTransactionID)
                                     .then(record => {
                                         if (record) {
                                             return record.certificate.holder_public_key === holderPublicKey ? record.certificate : Promise.reject('certificate_request_invalid');
                                         }
                                         return this._verifyPassPayment(fundingTransactionID, holderPublicKey, brokerKey)
                                                    .then(() => {
                                                        const now         = this._now();
                                                        const certificatePrivateKey = cloudPass.deriveCertificatePrivateKey(brokerKey.private_key, fundingTransactionID);
                                                        const certificate = cloudPass.signCertificate({
                                                            version               : CLOUD_PASS_VERSION,
                                                            broker_address        : brokerKey.address,
                                                            broker_public_key     : brokerKey.public_key,
                                                            certificate_public_key: cloudPass.getPublicKey(certificatePrivateKey),
                                                            holder_public_key     : holderPublicKey,
                                                            funding_transaction_id: fundingTransactionID,
                                                            data_bytes            : config.CLOUD_BROKER_PASS_DATA_BYTES,
                                                            piece_bytes           : config.CLOUD_BROKER_PASS_PIECE_BYTES,
                                                            piece_count           : config.CLOUD_BROKER_PASS_DATA_BYTES / config.CLOUD_BROKER_PASS_PIECE_BYTES,
                                                            start_date            : now,
                                                            end_date              : now + config.CLOUD_BROKER_PASS_DURATION
                                                        }, brokerKey.private_key);
                                                        return cloudBrokerRepository.addCertificate(certificate)
                                                                                    .then(() => {
                                                                                        console.log(`[broker] issued certificate ${certificate.certificate_id} for payment ${fundingTransactionID}`);
                                                                                        return certificate;
                                                                                    });
                                                    });
                                     })
                                     .then(certificate => {
                                         unlock();
                                         resolve({certificate});
                                     })
                                     .catch(error => {
                                         unlock();
                                         reject(error);
                                     });
            });
        });
    }

    /**
     * a piece of a certificate. a piece is issued only after the one before
     * it.
     */
    issuePiece(body) {
        const pieceIndex = body?.piece_index;
        return database.getRepository('cloud_broker')
                       .getCertificate(body?.certificate_id)
                       .then(record => {
                           if (!record) {
                               return Promise.reject('certificate_not_found');
                           }
                           const certificate = record.certificate;
                           if (!cloudPass.isValidHolderMessage({
                               certificate_id: certificate.certificate_id,
                               piece_index   : pieceIndex
                           }, body.signature, certificate.holder_public_key)) {
                               return Promise.reject('piece_request_invalid');
                           }
                           if (!Number.isInteger(pieceIndex) || pieceIndex < 0 || pieceIndex >= certificate.piece_count) {
                               return Promise.reject('piece_not_found');
                           }
                           if (pieceIndex > record.piece_issued_count) {
                               return Promise.reject('piece_out_of_order');
                           }
                           if (certificate.end_date <= this._now()) {
                               return Promise.reject('certificate_expired');
                           }
                           const brokerKey = this.getBrokerKey();
                           const piece     = cloudPass.signPiece(certificate, pieceIndex, cloudPass.deriveCertificatePrivateKey(brokerKey.private_key, certificate.funding_transaction_id));
                           return database.getRepository('cloud_broker')
                                          .updatePieceIssuedCount(certificate.certificate_id, pieceIndex + 1)
                                          .then(() => ({piece}));
                       });
    }

    /**
     * stores the receipts of an exit node's report that move a certificate
     * forward at that node
     */
    addReport(report) {
        const {
                  valid,
                  reason
              } = cloudPass.verifyHostReport(report);
        if (!valid) {
            return Promise.reject(reason);
        }

        const cloudBrokerRepository = database.getRepository('cloud_broker');
        const now                   = this._now();
        const resultList            = [];
        return report.receipt_list.reduce((pipeline, entry) => pipeline.then(() => cloudBrokerRepository.getCertificate(entry.certificate_id)
                                                                                                         .then(record => {
                                                                                                             if (!record) {
                                                                                                                 return 'certificate_not_found';
                                                                                                             }
                                                                                                             if (!cloudPass.isValidReceipt(record.certificate, entry.receipt, entry.signature, report.node_id)) {
                                                                                                                 return 'receipt_invalid';
                                                                                                             }
                                                                                                             return cloudBrokerRepository.upsertReceipt(entry.certificate_id, report.node_id, entry.receipt, entry.signature, now)
                                                                                                                                         .then(isNew => isNew ? 'accepted' : 'receipt_not_newer');
                                                                                                         })
                                                                                                         .then(status => resultList.push({
                                                                                                             certificate_id: entry.certificate_id,
                                                                                                             sequence      : entry.receipt.sequence,
                                                                                                             status
                                                                                                         }))), Promise.resolve())
                     .then(() => _.some(resultList, {status: 'accepted'}) ? cloudBrokerRepository.upsertHost(report.node_id, report.payout_address, now) : undefined)
                     .then(() => {
                         console.log(`[broker] report from node ${report.node_id}: ${_.filter(resultList, {status: 'accepted'}).length} of ${resultList.length} receipts accepted`);
                         return {receipt_list: resultList};
                     });
    }

    /**
     * what each exit node has earned from its receipts. a certificate pays
     * at most its data in total; when exit nodes receipt more, the earliest
     * receipts are paid first.
     * @return {Promise<Object>} node id: amount earned
     */
    getEarnedAmountByNode() {
        return database.getRepository('cloud_broker')
                       .listReceiptWithCertificate()
                       .then(receiptList => {
                           const earned = {};
                           _.each(_.groupBy(receiptList, 'certificate_id'), certificateReceiptList => {
                               let bytesLeft = certificateReceiptList[0].data_bytes;
                               _.sortBy(certificateReceiptList, ['first_receipt_date', 'node_id']).forEach(receipt => {
                                   const bytesPaid       = Math.min(receipt.total_bytes, bytesLeft);
                                   bytesLeft -= bytesPaid;
                                   earned[receipt.node_id] = (earned[receipt.node_id] || 0) + cloudPass.getPayoutAmount(bytesPaid, config.CLOUD_BROKER_POOL_RATE);
                               });
                           });
                           return earned;
                       });
    }

    /**
     * exit nodes with what they earned, were paid and are owed
     */
    listHost() {
        return Promise.all([
            this.getEarnedAmountByNode(),
            database.getRepository('cloud_broker').listHost()
        ]).then(([earned, hostList]) => hostList.map(host => ({
            ...host,
            amount_earned: earned[host.node_id] || 0,
            amount_owed  : Math.max(0, (earned[host.node_id] || 0) - host.amount_paid)
        })));
    }

    /**
     * pays the exit nodes owed at least CLOUD_BROKER_PAYOUT_AMOUNT_MIN, in
     * transactions of up to CLOUD_BROKER_PAYOUT_OUTPUT_MAX - 1 exit nodes
     * (the last output returns the change)
     * @return {Promise<Array>} the payout transactions
     */
    doPayout() {
        if (!this.server) {
            return Promise.resolve([]);
        }
        return new Promise(resolve => {
            mutex.lock(['cloud_broker_payout'], unlock => {
                const transactionList = [];
                this.listHost()
                    .then(hostList => {
                        const payableList = _.filter(hostList, host => host.amount_owed >= config.CLOUD_BROKER_PAYOUT_AMOUNT_MIN);
                        const addressRepository = database.getRepository('address');
                        return _.chunk(payableList, config.CLOUD_BROKER_PAYOUT_OUTPUT_MAX - 1).reduce((pipeline, batch) => pipeline.then(() => {
                            const outputList = batch.map(host => {
                                const {
                                          address               : addressBase,
                                          version               : addressVersion,
                                          identifier            : addressKeyIdentifier
                                      } = addressRepository.getAddressComponent(host.payout_address);
                                return {
                                    address_base          : addressBase,
                                    address_version       : addressVersion,
                                    address_key_identifier: addressKeyIdentifier,
                                    amount                : host.amount_owed
                                };
                            });
                            return wallet.addTransaction(outputList, {
                                fee_type: 'transaction_fee_default',
                                amount  : config.TRANSACTION_FEE_PROXY
                            }).then(transactions => {
                                const transaction = _.last(transactions);
                                transactionList.push(transaction);
                                console.log(`[broker] paid ${batch.length} exit nodes ${_.sum(_.map(batch, 'amount_owed'))} in transaction ${transaction.transaction_id}`);
                                return database.getRepository('cloud_broker').addPayout(transaction.transaction_id, batch.map(host => ({
                                    node_id: host.node_id,
                                    amount : host.amount_owed
                                })), this._now());
                            });
                        }), Promise.resolve());
                    })
                    .catch(error => console.log(`[broker] payout error: ${error?.error || error}`))
                    .then(() => {
                        unlock();
                        resolve(transactionList);
                    });
            });
        });
    }

    _onRequest(request, response) {
        const route = `${request.method} ${request.url}`;
        const handlerMap = {
            'POST /broker/certificate': body => this.issueCertificate(body),
            'POST /broker/piece'      : body => this.issuePiece(body),
            'POST /broker/report'     : body => this.addReport(body?.report)
        };
        if (route === 'GET /broker/terms') {
            return sendJSON(response, 200, {terms: this.getTerms()});
        }
        const handler = handlerMap[route];
        if (!handler) {
            return sendJSON(response, 404, {error: 'not_found'});
        }
        readJSONBody(request, BODY_SIZE_MAX)
            .then(handler)
            .then(result => sendJSON(response, 200, result))
            .catch(error => sendJSON(response, 403, {error: error?.message || error}));
    }

    isRunning() {
        return !!this.server;
    }

    _onCloudVersionUpdate({cloud_enabled: isCloudEnabled}) {
        if (!isCloudEnabled && this.server) {
            console.log('[broker] this node version is below the minimum for cloud features: stopping the broker');
            this.stop();
        }
        else if (isCloudEnabled && !this.server) {
            this.initialize().catch(_ => _);
        }
    }

    initialize() {
        if (!this._cloudVersionListener) {
            this._cloudVersionListener = this._onCloudVersionUpdate.bind(this);
            eventBus.on('cloud_version_min_update', this._cloudVersionListener);
        }
        if (!config.MODE_CLOUD_BROKER || this.server) {
            return Promise.resolve();
        }
        if (!cloudVersion.isCloudEnabled()) {
            console.log(`[broker] not started: this node version is below the minimum for cloud features (${cloudVersion.getVersionMin()})`);
            return Promise.resolve();
        }
        if (!network.certificatePem) {
            return Promise.reject('node_certificate_not_found');
        }
        if (cloudPass.getPayoutAmount(config.CLOUD_BROKER_PASS_DATA_BYTES, config.CLOUD_BROKER_POOL_RATE) > config.CLOUD_BROKER_PASS_PRICE ||
            config.CLOUD_BROKER_PASS_DATA_BYTES % config.CLOUD_BROKER_PASS_PIECE_BYTES !== 0) {
            return Promise.reject('broker_terms_invalid');
        }

        return new Promise(resolve => {
            this.server = https.createServer({
                key : network.certificatePrivateKeyPem,
                cert: network.certificatePem
            }, (request, response) => this._onRequest(request, response));
            this.server.on('error', error => console.log(`[broker] server error: ${error.message}`));
            this.server.listen(config.NODE_PORT_BROKER, config.NODE_BIND_IP, () => {
                console.log(`[broker] broker ${this.getBrokerKey().address} listening on port ${config.NODE_PORT_BROKER}`);
                task.scheduleTask('cloud_broker_payout', this.doPayout.bind(this), config.CLOUD_BROKER_PAYOUT_INTERVAL * 1000, true);
                resolve();
            });
        });
    }

    stop() {
        task.removeTask('cloud_broker_payout');
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}


export default new Broker();
