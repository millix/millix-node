import _ from 'lodash';
import crypto from 'crypto';
import base58 from 'bs58';
import secp256k1 from 'secp256k1';
import config from '../../core/config/config';
import database from '../../database/database';
import walletUtils from '../../core/wallet/wallet-utils';
import objectHash from '../../core/crypto/object-hash';
import signature from '../../core/crypto/signature';

export const CLOUD_PASS_VERSION = 1;

const CERTIFICATE_KEY_LIST = [
    'version',
    'broker_address',
    'broker_public_key',
    'certificate_public_key',
    'holder_public_key',
    'funding_transaction_id',
    'data_bytes',
    'piece_bytes',
    'piece_count',
    'start_date',
    'end_date',
    'certificate_id',
    'broker_signature'
].sort();
// a trial certificate also carries trial: true
const CERTIFICATE_TRIAL_KEY_LIST = [
    ...CERTIFICATE_KEY_LIST,
    'trial'
].sort();
const PIECE_KEY_LIST       = [
    'version',
    'certificate_id',
    'piece_index',
    'piece_bytes',
    'end_date',
    'signature'
].sort();
const RECEIPT_KEY_LIST     = [
    'version',
    'certificate_id',
    'node_id',
    'piece_index',
    'total_bytes',
    'sequence',
    'receipt_date'
].sort();
const BROKER_TERMS_KEY_LIST = [
    'address',
    'public_key',
    'pass_price',
    'pass_data_bytes',
    'pass_piece_bytes',
    'pass_duration',
    'pool_rate',
    'payout_interval',
    'signature'
].sort();
// the terms of a broker that offers a free trial also carry
// trial_data_bytes
const BROKER_TERMS_TRIAL_KEY_LIST = [
    ...BROKER_TERMS_KEY_LIST,
    'trial_data_bytes'
].sort();
const NODE_REQUEST_KEY_LIST = [
    'node_id',
    'node_public_key',
    'request_date',
    'signature'
].sort();
const HOST_REPORT_KEY_LIST  = [
    'node_id',
    'node_public_key',
    'payout_address',
    'report_date',
    'receipt_list',
    'signature'
].sort();

export const GB = 1024 * 1024 * 1024;


/**
 * the records of the broker flow, and the checks every party makes.
 *
 * a broker is an address and a public key (a wallet key of the broker's
 * node). a user pays the broker's pass price to the broker address in a
 * transaction whose signed output metadata names the holder key, and the
 * broker answers with a prepaid certificate:
 *
 * - the certificate names the broker, the holder key (kept by the user), the
 *   data it covers in pieces of piece_bytes (1 GB), its dates and a
 *   certificate key, and is signed by the broker key.
 * - each piece names the certificate and its index and is signed by the
 *   certificate key. the broker issues the pieces one at a time, in order, so
 *   an exit node can see how much data the user has fetched without asking
 *   the broker.
 * - the holder signs receipts for each exit node: the running total of bytes
 *   received there and a sequence.
 * - an exit node sends the latest receipts to the broker in a report signed
 *   by its node key, naming the address the broker pays.
 *
 * the broker pays each exit node for the receipted bytes at its pool rate,
 * never more than a certificate's data in total across exit nodes.
 *
 * a broker may offer a free trial: a certificate marked trial: true that no
 * payment funds. its funding_transaction_id is the trial id, a hash of the
 * holder key, so a holder key gets one trial certificate. pieces and
 * receipts work as for a pass; the broker pays exit nodes for trial traffic
 * from its own funds.
 */
class CloudPass {

    _isPositiveInteger(value) {
        return Number.isInteger(value) && value > 0;
    }

    _isPublicKey(value) {
        try {
            return typeof value === 'string' && base58.decode(value).length === 33;
        }
        catch (e) {
            return false;
        }
    }

    _sign(body, privateKey) {
        return signature.sign(objectHash.getHashBuffer(body), privateKey);
    }

    _verify(body, signatureValue, publicKey) {
        try {
            return typeof signatureValue === 'string' && signature.verify(objectHash.getHashBuffer(body), signatureValue, publicKey);
        }
        catch (e) {
            return false;
        }
    }

    getPublicKey(privateKey) {
        return base58.encode(Buffer.from(secp256k1.publicKeyCreate(privateKey, true)));
    }

    getAddressBaseFromPublicKey(publicKey) {
        return walletUtils.getAddressFromPublicKey(base58.decode(publicKey));
    }

    /**
     * true if address is a wallet address whose base is the address of
     * publicKey
     */
    isAddressOfPublicKey(address, publicKey) {
        try {
            const {address: addressBase} = database.getRepository('address').getAddressComponent(address);
            return walletUtils.isValidAddress(addressBase) && this.getAddressBaseFromPublicKey(publicKey) === addressBase;
        }
        catch (e) {
            return false;
        }
    }

    getAddressBase(address) {
        return database.getRepository('address').getAddressComponent(address).address;
    }

    /**
     * the key that signs the pieces of a certificate is derived from the
     * broker key and the funding transaction, so the broker never stores it
     */
    deriveCertificatePrivateKey(brokerPrivateKey, fundingTransactionID) {
        return crypto.createHmac('sha256', brokerPrivateKey).update(`tangled-broker-certificate:${fundingTransactionID}`).digest();
    }

    /**
     * the id that takes the place of the funding transaction in the trial
     * certificate of a holder key
     */
    getTrialID(holderPublicKey) {
        return objectHash.getCHash288({trial_holder_public_key: holderPublicKey});
    }

    isTrialCertificate(certificate) {
        return certificate?.trial === true;
    }

    /**
     * a trial is one piece when it is smaller than a pass piece, else pieces
     * of the pass piece size
     */
    getTrialPieceBytes(trialDataBytes, passPieceBytes) {
        return Math.min(trialDataBytes, passPieceBytes);
    }

    isValidTrialSize(trialDataBytes, passPieceBytes) {
        const pieceBytes = this.getTrialPieceBytes(trialDataBytes, passPieceBytes);
        return this._isPositiveInteger(trialDataBytes) && this._isPositiveInteger(passPieceBytes) &&
               trialDataBytes % pieceBytes === 0 && trialDataBytes / pieceBytes <= config.CLOUD_PASS_PIECE_COUNT_MAX;
    }

    /**
     * the broker's terms, as its broker offer carries them, signed by the
     * broker key together with the node id that serves them
     */
    signBrokerTerms(terms, nodeID, brokerPrivateKey) {
        return {
            ...terms,
            signature: this._sign({
                ...terms,
                node_id: nodeID
            }, brokerPrivateKey)
        };
    }

    isValidBrokerTerms(terms, nodeID) {
        return _.isPlainObject(terms) &&
               (_.isEqual(_.keys(terms).sort(), BROKER_TERMS_KEY_LIST) ||
                _.isEqual(_.keys(terms).sort(), BROKER_TERMS_TRIAL_KEY_LIST) && this.isValidTrialSize(terms.trial_data_bytes, terms.pass_piece_bytes)) &&
               this._isPublicKey(terms.public_key) &&
               this.isAddressOfPublicKey(terms.address, terms.public_key) &&
               this._isPositiveInteger(terms.pass_price) &&
               this._isPositiveInteger(terms.pass_piece_bytes) &&
               this._isPositiveInteger(terms.pass_data_bytes) &&
               terms.pass_data_bytes % terms.pass_piece_bytes === 0 &&
               terms.pass_data_bytes / terms.pass_piece_bytes <= config.CLOUD_PASS_PIECE_COUNT_MAX &&
               this._isPositiveInteger(terms.pass_duration) &&
               terms.pass_duration <= config.CLOUD_PASS_DURATION_MAX &&
               this._isPositiveInteger(terms.pool_rate) &&
               // a pass can never pay out more than it costs
               this.getPayoutAmount(terms.pass_data_bytes, terms.pool_rate) <= terms.pass_price &&
               this._isPositiveInteger(terms.payout_interval) &&
               this._verify({
                   ..._.omit(terms, ['signature']),
                   node_id: nodeID
               }, terms.signature, terms.public_key);
    }

    /**
     * the amount paid for totalBytes at poolRate millix per GB
     */
    getPayoutAmount(totalBytes, poolRate) {
        return Math.floor(totalBytes * poolRate / GB);
    }

    getCertificateBody(certificate) {
        return _.omit(certificate, [
            'certificate_id',
            'broker_signature'
        ]);
    }

    /**
     * @param body the certificate without certificate_id and broker_signature
     * @param brokerPrivateKey
     */
    signCertificate(body, brokerPrivateKey) {
        return {
            ...body,
            certificate_id  : objectHash.getCHash288(body),
            broker_signature: this._sign(body, brokerPrivateKey)
        };
    }

    /**
     * @param certificate
     * @param now unix time in seconds
     * @return {{valid: boolean, reason?: string}}
     */
    verifyCertificate(certificate, now) {
        if (!_.isPlainObject(certificate) ||
            !(_.isEqual(_.keys(certificate).sort(), CERTIFICATE_KEY_LIST) || _.isEqual(_.keys(certificate).sort(), CERTIFICATE_TRIAL_KEY_LIST) && certificate.trial === true) ||
            certificate.version !== CLOUD_PASS_VERSION ||
            !this._isPublicKey(certificate.broker_public_key) || !this._isPublicKey(certificate.certificate_public_key) ||
            !this._isPublicKey(certificate.holder_public_key) || typeof certificate.funding_transaction_id !== 'string' ||
            !this._isPositiveInteger(certificate.piece_bytes) || !this._isPositiveInteger(certificate.piece_count) ||
            certificate.piece_count > config.CLOUD_PASS_PIECE_COUNT_MAX ||
            certificate.data_bytes !== certificate.piece_bytes * certificate.piece_count) {
            return {
                valid : false,
                reason: 'certificate_invalid_format'
            };
        }

        if (!this.isAddressOfPublicKey(certificate.broker_address, certificate.broker_public_key)) {
            return {
                valid : false,
                reason: 'certificate_invalid_broker'
            };
        }

        if (!this._isPositiveInteger(certificate.start_date) || !this._isPositiveInteger(certificate.end_date) ||
            certificate.end_date <= certificate.start_date || certificate.end_date - certificate.start_date > config.CLOUD_PASS_DURATION_MAX ||
            certificate.start_date > now + config.CLOUD_OFFER_CLOCK_SKEW_TOLERANCE) {
            return {
                valid : false,
                reason: 'certificate_invalid_date'
            };
        }

        if (certificate.end_date <= now) {
            return {
                valid : false,
                reason: 'certificate_expired'
            };
        }

        const body = this.getCertificateBody(certificate);
        let certificateID;
        try {
            certificateID = objectHash.getCHash288(body);
        }
        catch (e) {
            certificateID = null;
        }
        if (certificateID !== certificate.certificate_id) {
            return {
                valid : false,
                reason: 'certificate_invalid_id'
            };
        }

        if (!this._verify(body, certificate.broker_signature, certificate.broker_public_key)) {
            return {
                valid : false,
                reason: 'certificate_invalid_signature'
            };
        }

        return {valid: true};
    }

    signPiece(certificate, pieceIndex, certificatePrivateKey) {
        const body = {
            version       : CLOUD_PASS_VERSION,
            certificate_id: certificate.certificate_id,
            piece_index   : pieceIndex,
            piece_bytes   : certificate.piece_bytes,
            end_date      : certificate.end_date
        };
        return {
            ...body,
            signature: this._sign(body, certificatePrivateKey)
        };
    }

    isValidPiece(certificate, piece) {
        return _.isPlainObject(piece) &&
               _.isEqual(_.keys(piece).sort(), PIECE_KEY_LIST) &&
               piece.version === CLOUD_PASS_VERSION &&
               piece.certificate_id === certificate.certificate_id &&
               Number.isInteger(piece.piece_index) && piece.piece_index >= 0 && piece.piece_index < certificate.piece_count &&
               piece.piece_bytes === certificate.piece_bytes &&
               piece.end_date === certificate.end_date &&
               this._verify(_.omit(piece, ['signature']), piece.signature, certificate.certificate_public_key);
    }

    signReceipt(receipt, holderPrivateKey) {
        return this._sign(receipt, holderPrivateKey);
    }

    isValidReceipt(certificate, receipt, receiptSignature, nodeID) {
        return _.isPlainObject(receipt) &&
               _.isEqual(_.keys(receipt).sort(), RECEIPT_KEY_LIST) &&
               receipt.version === CLOUD_PASS_VERSION &&
               receipt.certificate_id === certificate.certificate_id &&
               receipt.node_id === nodeID &&
               Number.isInteger(receipt.piece_index) && receipt.piece_index >= 0 && receipt.piece_index < certificate.piece_count &&
               Number.isInteger(receipt.total_bytes) && receipt.total_bytes >= 0 &&
               this._isPositiveInteger(receipt.sequence) &&
               this._isPositiveInteger(receipt.receipt_date) &&
               this._verify(receipt, receiptSignature, certificate.holder_public_key);
    }

    /**
     * the holder proves its key to the broker (for a certificate or a piece)
     * and to an exit node (the challenge)
     */
    signHolderMessage(message, holderPrivateKey) {
        return this._sign(message, holderPrivateKey);
    }

    isValidHolderMessage(message, messageSignature, holderPublicKey) {
        return this._verify(message, messageSignature, holderPublicKey);
    }

    /**
     * an exit node's report of its latest receipts, signed by its node key
     */
    signHostReport(body, nodePrivateKey) {
        return {
            ...body,
            signature: walletUtils.signMessage(nodePrivateKey, body)
        };
    }

    verifyHostReport(report) {
        if (!_.isPlainObject(report) || !_.isEqual(_.keys(report).sort(), HOST_REPORT_KEY_LIST) ||
            !Array.isArray(report.receipt_list) || report.receipt_list.length === 0 ||
            report.receipt_list.length > config.CLOUD_BROKER_REPORT_RECEIPT_MAX ||
            !_.every(report.receipt_list, entry => _.isPlainObject(entry) && typeof entry.certificate_id === 'string' &&
                                                 _.isPlainObject(entry.receipt) && typeof entry.signature === 'string') ||
            !this._isPositiveInteger(report.report_date)) {
            return {
                valid : false,
                reason: 'report_invalid_format'
            };
        }

        try {
            const {address: addressBase} = database.getRepository('address').getAddressComponent(report.payout_address);
            if (!walletUtils.isValidAddress(addressBase)) {
                throw Error();
            }
        }
        catch (e) {
            return {
                valid : false,
                reason: 'report_invalid_payout_address'
            };
        }

        if (typeof report.signature !== 'string' || !walletUtils.isValidNodeIdentity(report.node_id, report.node_public_key, _.omit(report, ['signature']), report.signature)) {
            return {
                valid : false,
                reason: 'report_invalid_signature'
            };
        }

        return {valid: true};
    }

    /**
     * an exit node's request to a broker about itself (whether the broker's
     * trial extends to it), signed by its node key
     */
    signNodeRequest(nodeID, nodePublicKey, requestDate, nodePrivateKey) {
        const body = {
            node_id        : nodeID,
            node_public_key: nodePublicKey,
            request_date   : requestDate
        };
        return {
            ...body,
            signature: walletUtils.signMessage(nodePrivateKey, body)
        };
    }

    /**
     * @param request
     * @param now unix time in seconds: the request must be dated within
     * CLOUD_OFFER_CLOCK_SKEW_TOLERANCE of it
     */
    isValidNodeRequest(request, now) {
        return _.isPlainObject(request) && _.isEqual(_.keys(request).sort(), NODE_REQUEST_KEY_LIST) &&
               this._isPositiveInteger(request.request_date) && Math.abs(request.request_date - now) <= config.CLOUD_OFFER_CLOCK_SKEW_TOLERANCE &&
               typeof request.signature === 'string' &&
               walletUtils.isValidNodeIdentity(request.node_id, request.node_public_key, _.omit(request, ['signature']), request.signature);
    }
}


export default new CloudPass();
