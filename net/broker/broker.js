import _ from 'lodash';
import https from 'https';
import network from '../network';
import config from '../../core/config/config';
import database from '../../database/database';
import wallet from '../../core/wallet/wallet';
import walletUtils from '../../core/wallet/wallet-utils';
import cloudPass, {CLOUD_PASS_VERSION} from './cloud-pass';
import {readJSONBody, sendJSON} from './node-request';
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
 * - POST /broker/trial {holder_public_key, signature}: when the broker
 *   offers a free trial, returns the trial certificate of the holder key
 *   (the same one for every request about that key).
 * - POST /broker/trial/status {node_id, node_public_key, request_date,
 *   signature}: tells an exit node, by a request signed by its node key,
 *   whether the trial extends to it.
 * - GET /broker/terms: the signed terms.
 *
 * every CLOUD_BROKER_PAYOUT_INTERVAL the broker pays each exit node what its
 * receipts earned at the pool rate and was not paid yet, once that reaches
 * CLOUD_BROKER_PAYOUT_AMOUNT_MIN. a certificate pays at most its data in
 * total: when exit nodes receipt more, the earliest receipts are paid first.
 * one transaction pays up to CLOUD_BROKER_PAYOUT_OUTPUT_MAX - 1 exit nodes;
 * the broker pays the fee and each exit node gets its full amount.
 *
 * the free trial (CLOUD_BROKER_TRIAL_ENABLED) is a certificate of
 * CLOUD_BROKER_TRIAL_DATA_BYTES marked as a trial, issued without payment.
 * its receipts are paid in the same payouts at the same pool rate, from the
 * broker's own funds. the trial does not extend to the exit nodes of the
 * trial block list: they refuse trial certificates once the broker tells
 * them, and while an exit node is on the list the broker holds back what its
 * trial receipts earned (paid if it is taken off the list).
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

    /**
     * whether this broker offers the free trial: CLOUD_BROKER_TRIAL_ENABLED,
     * or when it is null, whether this broker is tangled's default broker
     * (the first of CLOUD_BROKER_LIST)
     */
    isTrialOffered() {
        return config.CLOUD_BROKER_TRIAL_ENABLED ?? (this.getBrokerKey().address === config.CLOUD_BROKER_LIST[0]?.address);
    }

    getTerms() {
        const brokerKey = this.getBrokerKey();
        const terms     = {
            address         : brokerKey.address,
            public_key      : brokerKey.public_key,
            pass_price      : config.CLOUD_BROKER_PASS_PRICE,
            pass_data_bytes : config.CLOUD_BROKER_PASS_DATA_BYTES,
            pass_piece_bytes: config.CLOUD_BROKER_PASS_PIECE_BYTES,
            pass_duration   : config.CLOUD_BROKER_PASS_DURATION,
            pool_rate       : config.CLOUD_BROKER_POOL_RATE,
            payout_interval : config.CLOUD_BROKER_PAYOUT_INTERVAL
        };
        if (this.isTrialOffered()) {
            terms.trial_data_bytes = config.CLOUD_BROKER_TRIAL_DATA_BYTES;
        }
        return cloudPass.signBrokerTerms(terms, network.nodeID, brokerKey.private_key);
    }

    /**
     * the outputs of a transaction that pay an address
     */
    _listPaymentOutput(transactionID, address) {
        return database.applyShards(shardID => database.getRepository('transaction', shardID)
                                                       .listTransactionOutput({
                                                           'transaction_output.transaction_id': transactionID,
                                                           'transaction_output.address'       : address
                                                       }))
                       .then(outputList => _.uniqBy(outputList, 'output_position'));
    }

    /**
     * checks that the transaction paid the pass price to the broker for this
     * holder key and is stable
     * @return {Promise<number>} the amount it paid the broker
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

            return this._listPaymentOutput(fundingTransactionID, brokerKey.address)
                           .then(outputList => {
                               if (_.some(outputList, output => output.is_double_spend === 1 || output.status === 3 || output.transaction_status === 3)) {
                                   return Promise.reject('payment_invalid');
                               }
                               if (_.sum(_.map(outputList, output => output.amount)) < config.CLOUD_BROKER_PASS_PRICE) {
                                   return Promise.reject('payment_too_small');
                               }
                               if (!_.every(outputList, output => output.is_stable === 1)) {
                                   return Promise.reject('payment_not_stable');
                               }
                               return _.sum(_.map(outputList, output => output.amount));
                           });
        });
    }

    /**
     * the certificate funded by fundingID (a payment, or the trial id of a
     * holder key), issued once
     * @param fundingID
     * @param holderPublicKey
     * @param isTrial
     * @param verifyFunding resolves with the amount paid (null for a trial)
     * before the certificate is first issued
     */
    _issueCertificateOnce(fundingID, holderPublicKey, isTrial, verifyFunding) {
        const brokerKey             = this.getBrokerKey();
        const cloudBrokerRepository = database.getRepository('cloud_broker');
        return new Promise((resolve, reject) => {
            mutex.lock([`cloud_broker_certificate_${fundingID}`], unlock => {
                cloudBrokerRepository.getCertificateByFundingTransaction(fundingID)
                                     .then(record => {
                                         if (record) {
                                             return record.certificate.holder_public_key === holderPublicKey ? record.certificate : Promise.reject(isTrial ? 'trial_request_invalid' : 'certificate_request_invalid');
                                         }
                                         return verifyFunding()
                                             .then(paymentAmount => {
                                                 const now        = this._now();
                                                 const dataBytes  = isTrial ? config.CLOUD_BROKER_TRIAL_DATA_BYTES : config.CLOUD_BROKER_PASS_DATA_BYTES;
                                                 const pieceBytes = isTrial ? cloudPass.getTrialPieceBytes(dataBytes, config.CLOUD_BROKER_PASS_PIECE_BYTES) : config.CLOUD_BROKER_PASS_PIECE_BYTES;
                                                 const certificatePrivateKey = cloudPass.deriveCertificatePrivateKey(brokerKey.private_key, fundingID);
                                                 const body       = {
                                                     version               : CLOUD_PASS_VERSION,
                                                     broker_address        : brokerKey.address,
                                                     broker_public_key     : brokerKey.public_key,
                                                     certificate_public_key: cloudPass.getPublicKey(certificatePrivateKey),
                                                     holder_public_key     : holderPublicKey,
                                                     funding_transaction_id: fundingID,
                                                     data_bytes            : dataBytes,
                                                     piece_bytes           : pieceBytes,
                                                     piece_count           : dataBytes / pieceBytes,
                                                     start_date            : now,
                                                     end_date              : now + config.CLOUD_BROKER_PASS_DURATION
                                                 };
                                                 if (isTrial) {
                                                     body.trial = true;
                                                 }
                                                 const certificate = cloudPass.signCertificate(body, brokerKey.private_key);
                                                 return cloudBrokerRepository.addCertificate(certificate, paymentAmount)
                                                                             .then(() => {
                                                                                 console.log(`[broker] issued ${isTrial ? 'trial ' : ''}certificate ${certificate.certificate_id} for ${isTrial ? 'holder key' : 'payment'} ${isTrial ? holderPublicKey : fundingID}`);
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

        const brokerKey = this.getBrokerKey();
        return this._issueCertificateOnce(fundingTransactionID, holderPublicKey, false,
            () => this._verifyPassPayment(fundingTransactionID, holderPublicKey, brokerKey));
    }

    /**
     * the trial certificate of a holder key, issued once: a second request
     * for the key returns the same certificate, even once it has expired
     */
    issueTrialCertificate(body) {
        const holderPublicKey = body?.holder_public_key;
        if (!this.isTrialOffered()) {
            return Promise.reject('trial_not_offered');
        }
        if (typeof holderPublicKey !== 'string' ||
            !cloudPass.isValidHolderMessage({
                trial_holder_public_key: holderPublicKey,
                broker_node_id         : network.nodeID
            }, body.signature, holderPublicKey)) {
            return Promise.reject('trial_request_invalid');
        }
        return this._issueCertificateOnce(cloudPass.getTrialID(holderPublicKey), holderPublicKey, true, () => Promise.resolve(null));
    }

    /**
     * tells an exit node whether the trial extends to it
     */
    getTrialStatus(body) {
        if (!cloudPass.isValidNodeRequest(body, this._now())) {
            return Promise.reject('trial_status_request_invalid');
        }
        return database.getRepository('cloud_broker')
                       .isTrialBlocked(body.node_id)
                       .then(isBlocked => ({
                           trial_offered : this.isTrialOffered(),
                           trial_extended: !isBlocked
                       }));
    }

    /**
     * the exit nodes the trial does not extend to
     */
    listTrialBlock() {
        return database.getRepository('cloud_broker').listTrialBlock();
    }

    /**
     * replaces the trial block list
     * @param nodeIDList the node ids of the exit nodes
     */
    setTrialBlockList(nodeIDList) {
        if (!Array.isArray(nodeIDList) || !_.every(nodeIDList, nodeID => typeof nodeID === 'string' && walletUtils.isValidAddress(nodeID))) {
            return Promise.reject('node_id_list_invalid');
        }
        return database.getRepository('cloud_broker')
                       .setTrialBlockList(_.uniq(nodeIDList), this._now())
                       .then(() => {
                           console.log(`[broker] the trial does not extend to ${_.uniq(nodeIDList).length} exit nodes`);
                           return this.listTrialBlock();
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

    _newEarned() {
        return {
            certificate_count: 0,
            bytes_receipted  : 0,
            bytes_payable    : 0,
            amount_earned    : 0,
            last_receipt_date: null
        };
    }

    /**
     * what each exit node's receipts earned, for passes and for trials. a
     * certificate pays at most its data in total; when exit nodes receipt
     * more, the earliest receipts are paid first. bytes_payable is what
     * counts within that.
     * @return {Promise<Object>} node id: {pass, trial}
     */
    _getEarnedByNode() {
        return database.getRepository('cloud_broker')
                       .listReceiptWithCertificate()
                       .then(receiptList => {
                           const earned = {};
                           _.each(_.groupBy(receiptList, 'certificate_id'), certificateReceiptList => {
                               let bytesLeft = certificateReceiptList[0].data_bytes;
                               const type    = certificateReceiptList[0].is_trial === 1 ? 'trial' : 'pass';
                               _.sortBy(certificateReceiptList, ['first_receipt_date', 'node_id']).forEach(receipt => {
                                   const bytesPaid = Math.min(receipt.total_bytes, bytesLeft);
                                   bytesLeft -= bytesPaid;
                                   if (!earned[receipt.node_id]) {
                                       earned[receipt.node_id] = {
                                           pass : this._newEarned(),
                                           trial: this._newEarned()
                                       };
                                   }
                                   const entry = earned[receipt.node_id][type];
                                   entry.certificate_count++;
                                   entry.bytes_receipted += receipt.total_bytes;
                                   entry.bytes_payable += bytesPaid;
                                   entry.amount_earned += cloudPass.getPayoutAmount(bytesPaid, config.CLOUD_BROKER_POOL_RATE);
                                   entry.last_receipt_date = Math.max(entry.last_receipt_date || 0, receipt.update_date);
                               });
                           });
                           return earned;
                       });
    }

    /**
     * what each exit node has earned from its receipts, passes and trials
     * @return {Promise<Object>} node id: amount earned
     */
    getEarnedAmountByNode() {
        return this._getEarnedByNode()
                   .then(earned => _.mapValues(earned, ({pass, trial}) => pass.amount_earned + trial.amount_earned));
    }

    /**
     * exit nodes with what they earned, were paid and are owed. what the
     * trial receipts of an exit node on the trial block list earned is held
     * back (amount_withheld_trial) while it is on the list.
     */
    listHost() {
        return Promise.all([
            this._getEarnedByNode(),
            database.getRepository('cloud_broker').listHost(),
            this.listTrialBlock()
        ]).then(([earned, hostList, trialBlockList]) => {
            const trialBlockSet = new Set(_.map(trialBlockList, 'node_id'));
            return hostList.map(host => {
                const {
                          pass,
                          trial
                      }              = earned[host.node_id] || {
                    pass : this._newEarned(),
                    trial: this._newEarned()
                };
                const isTrialBlocked = trialBlockSet.has(host.node_id);
                const amountOwedPass = Math.max(0, pass.amount_earned - (host.amount_paid - host.amount_paid_trial));
                const amountDueTrial = Math.max(0, trial.amount_earned - host.amount_paid_trial);
                return {
                    ...host,
                    amount_earned        : pass.amount_earned + trial.amount_earned,
                    amount_earned_trial  : trial.amount_earned,
                    amount_owed          : amountOwedPass + (isTrialBlocked ? 0 : amountDueTrial),
                    amount_owed_trial    : isTrialBlocked ? 0 : amountDueTrial,
                    amount_withheld_trial: isTrialBlocked ? amountDueTrial : 0,
                    is_trial_blocked     : isTrialBlocked
                };
            });
        });
    }

    /**
     * what a pass paid the broker: stored when the certificate was issued,
     * or read from its payment for a certificate issued before that
     * @return {Promise<number|null>} null when the payment is not found
     */
    _getPassPaymentAmount(certificate, brokerAddress) {
        if (certificate.payment_amount !== null) {
            return Promise.resolve(certificate.payment_amount);
        }
        return this._listPaymentOutput(certificate.funding_transaction_id, brokerAddress)
                   .then(outputList => outputList.length > 0 ? _.sum(_.map(outputList, output => output.amount)) : null)
                   .catch(() => null);
    }

    /**
     * what this broker earned and spent, from its own records: the passes it
     * sold (what their payments paid it), what the exit nodes' receipts
     * earned for passes and for trials, and what its payouts paid them. each
     * exit node shows its trial certificates, bytes and payouts, the exit
     * nodes carrying the most trial bytes first. payout fees are not
     * counted: payout_transaction_count says how many were paid.
     */
    getReport() {
        const cloudBrokerRepository = database.getRepository('cloud_broker');
        const brokerAddress         = this.getBrokerKey().address;
        return Promise.all([
            this.listHost(),
            this._getEarnedByNode(),
            cloudBrokerRepository.listCertificate(),
            cloudBrokerRepository.listPayoutSummaryByNode(),
            this.listTrialBlock(),
            cloudBrokerRepository.countReceiptedCertificate(),
            cloudBrokerRepository.countPayoutTransaction()
        ]).then(([hostList, earned, certificateList, payoutSummaryList, trialBlockList, receiptedCount, payoutTransactionCount]) => {
            const passList = _.filter(certificateList, certificate => certificate.is_trial !== 1);
            return Promise.all(passList.map(certificate => this._getPassPaymentAmount(certificate, brokerAddress)))
                          .then(paymentAmountList => {
                              const payoutByNode     = _.keyBy(payoutSummaryList, 'node_id');
                              const trialBlockByNode = _.keyBy(trialBlockList, 'node_id');
                              const reportHostList   = _.orderBy(hostList.map(host => {
                                  const {
                                            pass,
                                            trial
                                        }                = earned[host.node_id] || {
                                      pass : this._newEarned(),
                                      trial: this._newEarned()
                                  };
                                  const payout           = payoutByNode[host.node_id] || {};
                                  const amountPaid       = payout.amount || 0;
                                  const amountPaidTrial  = payout.amount_trial || 0;
                                  return {
                                      node_id         : host.node_id,
                                      payout_address  : host.payout_address,
                                      is_trial_blocked: host.is_trial_blocked,
                                      trial_block_date: trialBlockByNode[host.node_id]?.create_date || null,
                                      trial           : {
                                          ...trial,
                                          amount_paid    : amountPaidTrial,
                                          amount_owed    : host.amount_owed_trial,
                                          amount_withheld: host.amount_withheld_trial
                                      },
                                      pass            : {
                                          ...pass,
                                          amount_paid: amountPaid - amountPaidTrial,
                                          amount_owed: host.amount_owed - host.amount_owed_trial
                                      },
                                      amount_paid     : amountPaid,
                                      payout_count    : payout.payout_count || 0,
                                      last_payout_date: payout.last_payout_date || null,
                                      create_date     : host.create_date
                                  };
                              }), [host => host.trial.bytes_receipted, 'node_id'], ['desc', 'asc']);

                              const sumOf = (type, field) => _.sum(_.map(reportHostList, host => host[type][field]));
                              const spent = _.mapValues({
                                  trial: ['bytes_receipted', 'bytes_payable', 'amount_earned', 'amount_paid', 'amount_owed', 'amount_withheld'],
                                  pass : ['bytes_receipted', 'bytes_payable', 'amount_earned', 'amount_paid', 'amount_owed']
                              }, (fieldList, type) => _.fromPairs(fieldList.map(field => [field, sumOf(type, field)])));
                              const amountSold = _.sum(_.filter(paymentAmountList, amount => amount !== null));
                              return {
                                  broker_address: brokerAddress,
                                  report_date   : this._now(),
                                  trial         : {
                                      offered   : this.isTrialOffered(),
                                      data_bytes: config.CLOUD_BROKER_TRIAL_DATA_BYTES
                                  },
                                  earned        : {
                                      pass_count                  : passList.length,
                                      pass_receipted_count        : receiptedCount.pass,
                                      pass_payment_amount         : amountSold,
                                      pass_payment_not_found_count: _.filter(paymentAmountList, amount => amount === null).length
                                  },
                                  spent         : {
                                      trial                   : {
                                          certificate_count          : certificateList.length - passList.length,
                                          certificate_receipted_count: receiptedCount.trial,
                                          ...spent.trial
                                      },
                                      pass                    : spent.pass,
                                      amount_paid             : spent.trial.amount_paid + spent.pass.amount_paid,
                                      payout_transaction_count: payoutTransactionCount
                                  },
                                  // what passes sold, less what the payouts
                                  // paid exit nodes for passes and trials
                                  net_amount    : amountSold - spent.trial.amount_paid - spent.pass.amount_paid,
                                  host_list     : reportHostList
                              };
                          });
        });
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
                                    node_id     : host.node_id,
                                    amount      : host.amount_owed,
                                    amount_trial: host.amount_owed_trial
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
            'POST /broker/certificate' : body => this.issueCertificate(body),
            'POST /broker/piece'       : body => this.issuePiece(body),
            'POST /broker/report'      : body => this.addReport(body?.report),
            'POST /broker/trial'       : body => this.issueTrialCertificate(body),
            'POST /broker/trial/status': body => this.getTrialStatus(body)
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

    initialize() {
        if (!config.MODE_CLOUD_BROKER || this.server) {
            return Promise.resolve();
        }
        if (!network.certificatePem) {
            return Promise.reject('node_certificate_not_found');
        }
        if (cloudPass.getPayoutAmount(config.CLOUD_BROKER_PASS_DATA_BYTES, config.CLOUD_BROKER_POOL_RATE) > config.CLOUD_BROKER_PASS_PRICE ||
            config.CLOUD_BROKER_PASS_DATA_BYTES % config.CLOUD_BROKER_PASS_PIECE_BYTES !== 0 ||
            !cloudPass.isValidTrialSize(config.CLOUD_BROKER_TRIAL_DATA_BYTES, config.CLOUD_BROKER_PASS_PIECE_BYTES)) {
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
