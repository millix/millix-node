import _ from 'lodash';
import crypto from 'crypto';
import config from '../../core/config/config';
import database from '../../database/database';
import wallet from '../../core/wallet/wallet';
import walletUtils from '../../core/wallet/wallet-utils';
import cloudOffer from '../cloud-offer';
import cloudPass from './cloud-pass';
import {requestNodeService} from './node-request';
import ntp from '../../core/ntp';
import console from '../../core/console';

export const PASS_STATUS_PAYING     = 'paying';
export const PASS_STATUS_PAID       = 'paid';
export const PASS_STATUS_ACTIVE     = 'active';
export const PASS_STATUS_FAILED     = 'failed';
// a trial asked of the broker
export const PASS_STATUS_REQUESTING = 'requesting';

const CERTIFICATE_RETRY_WAIT_TIME = 5000;


/**
 * the user side of the broker: buys passes and fetches their pieces.
 *
 * buying a pass pays the broker's pass price to the broker address in a
 * version 3 transaction whose signed metadata names the holder key, then asks
 * the broker for the prepaid certificate until the payment is stable. the
 * holder key is derived from this wallet's first key and the pass id, so it
 * is never stored.
 *
 * a broker's free trial is a pass whose id is derived from the broker
 * address: this wallet has one trial holder key for each broker, and the
 * broker issues one trial certificate for a holder key.
 */
class PassWallet {
    constructor() {
        this._certificateRequestSet = new Set();
    }

    _now() {
        return Math.floor(ntp.now().getTime() / 1000);
    }

    getHolderPrivateKey(passID) {
        const extendedPrivateKey = wallet.getActiveWalletKey(wallet.getDefaultActiveWallet());
        if (!extendedPrivateKey) {
            throw Error('wallet_not_active');
        }
        const walletPrivateKey = walletUtils.derivePrivateKey(extendedPrivateKey, 0, 0);
        return crypto.createHmac('sha256', walletPrivateKey).update(`tangled-cloud-pass:${passID}`).digest();
    }

    getDefaultBrokerAddress() {
        return config.CLOUD_BROKER_LIST[0]?.address;
    }

    /**
     * the newest valid broker offer of a broker
     */
    findBrokerOffer(brokerAddress) {
        return cloudOffer.listOffers({service: 'broker'}, 'create_date desc', 1000)
                         .then(offerList => _.find(offerList, offer => offer.broker?.address === brokerAddress && cloudOffer.verifyOffer(offer).valid))
                         .then(offer => offer || Promise.reject('broker_offer_not_found'));
    }

    _brokerRequest(offer, path, body) {
        return requestNodeService(offer.endpoint, offer.node_id, 'POST', path, body);
    }

    /**
     * pays the broker for a pass. the certificate is fetched in the
     * background once the payment is stable (list_cloud_pass).
     * @param brokerAddress defaults to the first broker of CLOUD_BROKER_LIST
     */
    buyPass(brokerAddress = this.getDefaultBrokerAddress()) {
        if (!brokerAddress) {
            return Promise.reject('broker_not_set');
        }

        const passRepository = database.getRepository('cloud_pass');
        const passID         = crypto.randomBytes(16).toString('hex');
        let holderPublicKey;
        return this.findBrokerOffer(brokerAddress)
                   .then(offer => {
                       holderPublicKey = cloudPass.getPublicKey(this.getHolderPrivateKey(passID));
                       const {
                                 address   : addressBase,
                                 version   : addressVersion,
                                 identifier: addressKeyIdentifier
                             }         = database.getRepository('address').getAddressComponent(offer.broker.address);
                       return passRepository.addPass(passID, brokerAddress, holderPublicKey, PASS_STATUS_PAYING)
                                            .then(() => wallet.addTransaction([
                                                {
                                                    address_base          : addressBase,
                                                    address_version       : addressVersion,
                                                    address_key_identifier: addressKeyIdentifier,
                                                    amount                : offer.broker.pass_price
                                                }
                                            ], {
                                                fee_type: 'transaction_fee_default',
                                                amount  : config.TRANSACTION_FEE_PROXY
                                            }, undefined, config.MODE_TEST_NETWORK ? 'la3l' : '0a30', {
                                                cloud_pass: {
                                                    holder_public_key: holderPublicKey,
                                                    broker_address   : brokerAddress
                                                }
                                            }));
                   })
                   .then(transactionList => {
                       const transaction = _.last(transactionList);
                       console.log(`[pass-wallet] paid broker ${brokerAddress} for pass ${passID} in transaction ${transaction.transaction_id}`);
                       return passRepository.updatePass(passID, {
                           funding_transaction_id: transaction.transaction_id,
                           status                : PASS_STATUS_PAID
                       });
                   })
                   .then(() => {
                       this.fetchCertificate(passID).catch(_ => _);
                       return this.getPass(passID);
                   })
                   .catch(error => passRepository.updatePass(passID, {status: PASS_STATUS_FAILED})
                                                 .catch(_ => _)
                                                 .then(() => Promise.reject(error?.error || error)));
    }

    getTrialPassID(brokerAddress) {
        return crypto.createHash('sha256').update(`tangled-cloud-trial:${brokerAddress}`).digest('hex').substring(0, 32);
    }

    /**
     * asks a broker for its free trial certificate, then fetches the first
     * piece. once this wallet's trial from the broker is active it is
     * returned as it is.
     * @param brokerAddress defaults to the first broker of CLOUD_BROKER_LIST
     */
    requestTrial(brokerAddress = this.getDefaultBrokerAddress()) {
        if (!brokerAddress) {
            return Promise.reject('broker_not_set');
        }

        const passRepository = database.getRepository('cloud_pass');
        const passID         = this.getTrialPassID(brokerAddress);
        return passRepository.getPass(passID)
                             .then(pass => {
                                 if (pass?.status === PASS_STATUS_ACTIVE) {
                                     return pass;
                                 }
                                 if (this._certificateRequestSet.has(passID)) {
                                     return Promise.reject('certificate_request_in_progress');
                                 }
                                 this._certificateRequestSet.add(passID);
                                 const holderPrivateKey = this.getHolderPrivateKey(passID);
                                 const holderPublicKey  = cloudPass.getPublicKey(holderPrivateKey);
                                 return (pass ? passRepository.updatePass(passID, {status: PASS_STATUS_REQUESTING}) : passRepository.addPass(passID, brokerAddress, holderPublicKey, PASS_STATUS_REQUESTING))
                                     .then(() => this.findBrokerOffer(brokerAddress))
                                     .then(offer => {
                                         if (!offer.broker.trial_data_bytes) {
                                             return Promise.reject('trial_not_offered');
                                         }
                                         return this._brokerRequest(offer, '/broker/trial', {
                                             holder_public_key: holderPublicKey,
                                             signature        : cloudPass.signHolderMessage({
                                                 trial_holder_public_key: holderPublicKey,
                                                 broker_node_id         : offer.node_id
                                             }, holderPrivateKey)
                                         });
                                     })
                                     .then(({certificate}) => {
                                         const {
                                                   valid,
                                                   reason
                                               } = cloudPass.verifyCertificate(certificate, this._now());
                                         if (!valid) {
                                             // certificate_expired: this
                                             // wallet's trial was used
                                             return Promise.reject(reason);
                                         }
                                         if (!cloudPass.isTrialCertificate(certificate) || certificate.holder_public_key !== holderPublicKey ||
                                             certificate.broker_address !== brokerAddress || certificate.funding_transaction_id !== cloudPass.getTrialID(holderPublicKey)) {
                                             return Promise.reject('certificate_not_for_this_pass');
                                         }
                                         return passRepository.updatePass(passID, {
                                             certificate_id: certificate.certificate_id,
                                             certificate,
                                             status        : PASS_STATUS_ACTIVE
                                         });
                                     })
                                     .then(() => this.getPiece(passID, 0))
                                     .then(() => {
                                         console.log(`[pass-wallet] trial pass ${passID} of broker ${brokerAddress} is active`);
                                         this._certificateRequestSet.delete(passID);
                                         return this.getPass(passID);
                                     })
                                     .catch(error => {
                                         this._certificateRequestSet.delete(passID);
                                         console.log(`[pass-wallet] no trial for pass ${passID}: ${error?.error || error}`);
                                         return passRepository.updatePass(passID, {status: PASS_STATUS_FAILED})
                                                              .catch(_ => _)
                                                              .then(() => Promise.reject(error?.error || error));
                                     });
                             });
    }

    /**
     * asks the broker for the certificate of a paid pass until the payment is
     * stable, then fetches the first piece
     */
    fetchCertificate(passID) {
        if (this._certificateRequestSet.has(passID)) {
            return Promise.reject('certificate_request_in_progress');
        }
        this._certificateRequestSet.add(passID);
        const passRepository = database.getRepository('cloud_pass');
        const startDate      = this._now();
        return passRepository.getPass(passID)
                             .then(pass => {
                                 if (!pass || pass.status !== PASS_STATUS_PAID) {
                                     return Promise.reject('pass_not_paid');
                                 }
                                 const holderPrivateKey = this.getHolderPrivateKey(passID);
                                 const tryRequest       = () => this.findBrokerOffer(pass.broker_address)
                                                                    .then(offer => this._brokerRequest(offer, '/broker/certificate', {
                                                                        funding_transaction_id: pass.funding_transaction_id,
                                                                        holder_public_key     : pass.holder_public_key,
                                                                        signature             : cloudPass.signHolderMessage({
                                                                            funding_transaction_id: pass.funding_transaction_id,
                                                                            broker_node_id        : offer.node_id
                                                                        }, holderPrivateKey)
                                                                    }))
                                                                    .catch(error => {
                                                                        // the payment needs to be stable first
                                                                        if (this._now() - startDate < config.CLOUD_PASS_PAYMENT_WAIT_TIME_MAX &&
                                                                            !['certificate_request_invalid', 'payment_not_for_this_pass', 'payment_too_small', 'payment_invalid'].includes(error)) {
                                                                            return new Promise(resolve => setTimeout(resolve, CERTIFICATE_RETRY_WAIT_TIME)).then(tryRequest);
                                                                        }
                                                                        return Promise.reject(error);
                                                                    });
                                 return tryRequest().then(({certificate}) => {
                                     const {
                                               valid,
                                               reason
                                           } = cloudPass.verifyCertificate(certificate, this._now());
                                     if (!valid) {
                                         return Promise.reject(reason);
                                     }
                                     if (certificate.holder_public_key !== pass.holder_public_key || certificate.broker_address !== pass.broker_address ||
                                         certificate.funding_transaction_id !== pass.funding_transaction_id) {
                                         return Promise.reject('certificate_not_for_this_pass');
                                     }
                                     return passRepository.updatePass(passID, {
                                         certificate_id: certificate.certificate_id,
                                         certificate,
                                         status        : PASS_STATUS_ACTIVE
                                     });
                                 });
                             })
                             .then(() => this.getPiece(passID, 0))
                             .then(() => {
                                 console.log(`[pass-wallet] pass ${passID} is active`);
                                 this._certificateRequestSet.delete(passID);
                                 return this.getPass(passID);
                             })
                             .catch(error => {
                                 this._certificateRequestSet.delete(passID);
                                 console.log(`[pass-wallet] no certificate for pass ${passID}: ${error}`);
                                 return Promise.reject(error);
                             });
    }

    /**
     * a piece of an active pass, from this node's store or from the broker
     */
    getPiece(passID, pieceIndex) {
        const passRepository = database.getRepository('cloud_pass');
        return passRepository.getPass(passID)
                             .then(pass => {
                                 if (!pass || pass.status !== PASS_STATUS_ACTIVE) {
                                     return Promise.reject('pass_not_active');
                                 }
                                 const piece = _.find(pass.piece_list, {piece_index: pieceIndex});
                                 if (piece) {
                                     return piece;
                                 }
                                 if (pieceIndex >= pass.certificate.piece_count) {
                                     return Promise.reject('pass_data_used');
                                 }
                                 return this.findBrokerOffer(pass.broker_address)
                                            .then(offer => this._brokerRequest(offer, '/broker/piece', {
                                                certificate_id: pass.certificate_id,
                                                piece_index   : pieceIndex,
                                                signature     : cloudPass.signHolderMessage({
                                                    certificate_id: pass.certificate_id,
                                                    piece_index   : pieceIndex
                                                }, this.getHolderPrivateKey(passID))
                                            }))
                                            .then(({piece}) => {
                                                if (!cloudPass.isValidPiece(pass.certificate, piece) || piece.piece_index !== pieceIndex) {
                                                    return Promise.reject('piece_invalid');
                                                }
                                                return passRepository.getPass(passID)
                                                                     .then(latestPass => passRepository.updatePass(passID, {
                                                                         piece_list: _.sortBy(_.uniqBy([...latestPass.piece_list, piece], 'piece_index'), 'piece_index')
                                                                     }))
                                                                     .then(() => piece);
                                            });
                             });
    }

    getPass(passID) {
        return database.getRepository('cloud_pass').getPass(passID);
    }

    listPass(where, orderBy = 'create_date desc', limit = 100) {
        return database.getRepository('cloud_pass').listPass(where, orderBy, limit);
    }

    initialize() {
        // passes paid before a restart get their certificate
        return this.listPass({status: PASS_STATUS_PAID})
                   .then(passList => passList.forEach(pass => this.fetchCertificate(pass.pass_id).catch(_ => _)))
                   .catch(_ => _);
    }
}


export default new PassWallet();
