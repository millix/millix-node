import _ from 'lodash';
import base58 from 'bs58';
import config from '../config/config';
import walletUtils from './wallet-utils';
import objectHash from '../crypto/object-hash';
import signature from '../crypto/signature';

const TERMS_KEY_LIST   = [
    'version',
    'payer_public_key',
    'payee_public_key',
    'amount',
    'portion_bytes',
    'portion_amount',
    'unlock_date',
    'nonce'
].sort();
const RECEIPT_KEY_LIST = [
    'version',
    'escrow_address_base',
    'node_id',
    'total_bytes',
    'sequence',
    'receipt_date'
].sort();

export const ESCROW_ACTION_CLAIM  = 'claim';
export const ESCROW_ACTION_REFUND = 'refund';
export const ESCROW_ACTION_CLOSE  = 'close';


/**
 * an escrow locks millix so that neither side can take them alone.
 *
 * the escrow terms name a payer key and a payee key, the amount, the price
 * of each portion of data and the unlock date. the escrow address is derived
 * from the hash of the terms (address version ADDRESS_VERSION_ESCROW, key
 * identifier equal to the address base), so an output sent to it commits to
 * the terms without revealing them. a transaction that spends an escrow
 * output reveals the terms in its signed output metadata and must follow
 * one of three paths:
 *
 * - claim: signed by the payee key, carrying a receipt signed by the payer
 *   key. the payee may take the receipted portions, and every millix not yet
 *   earned must go back to the same escrow address.
 * - refund: signed by the payer key, dated at or after the unlock date.
 * - close: signed by both keys, any outputs.
 *
 * these rules run in walletUtils.isValidTransactionObject, so every node
 * applies them when it verifies a transaction.
 */
class Escrow {

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

    isEscrowAddressVersion(addressVersion) {
        return addressVersion === config.ADDRESS_VERSION_ESCROW;
    }

    isValidTerms(terms) {
        return _.isPlainObject(terms) &&
               _.isEqual(_.keys(terms).sort(), TERMS_KEY_LIST) &&
               terms.version === config.ESCROW_TERMS_VERSION &&
               this._isPublicKey(terms.payer_public_key) &&
               this._isPublicKey(terms.payee_public_key) &&
               terms.payer_public_key !== terms.payee_public_key &&
               this._isPositiveInteger(terms.amount) &&
               this._isPositiveInteger(terms.portion_bytes) &&
               terms.portion_bytes >= config.ESCROW_PORTION_BYTES_MIN &&
               this._isPositiveInteger(terms.portion_amount) &&
               terms.portion_amount <= terms.amount &&
               this._isPositiveInteger(terms.unlock_date) &&
               typeof terms.nonce === 'string' && /^[0-9a-f]{32}$/.test(terms.nonce);
    }

    getAddressBaseFromTerms(terms) {
        return walletUtils.getAddressFromPublicKey(objectHash.getHashBuffer(terms));
    }

    /**
     * @param terms
     * @return {{address_base, address_version, address_key_identifier, address}}
     */
    getEscrowAddress(terms) {
        const addressBase = this.getAddressBaseFromTerms(terms);
        return {
            address_base          : addressBase,
            address_version       : config.ADDRESS_VERSION_ESCROW,
            address_key_identifier: addressBase,
            address               : `${addressBase}${config.ADDRESS_VERSION_ESCROW}${addressBase}`
        };
    }

    getAddressFromPublicKey(publicKey) {
        return walletUtils.getAddressFromPublicKey(base58.decode(publicKey));
    }

    /**
     * the amount the payee has earned for totalBytes: whole portions only,
     * never more than the escrow amount
     */
    getEarnedAmount(terms, totalBytes) {
        return Math.min(terms.amount, Math.floor(totalBytes / terms.portion_bytes) * terms.portion_amount);
    }

    getBytesCovered(terms) {
        return Math.floor(terms.amount / terms.portion_amount) * terms.portion_bytes;
    }

    signReceipt(receipt, privateKeyBuffer) {
        return signature.sign(objectHash.getHashBuffer(receipt), privateKeyBuffer);
    }

    isValidReceipt(terms, receipt, receiptSignature, addressBase) {
        try {
            return _.isPlainObject(receipt) &&
                   _.isEqual(_.keys(receipt).sort(), RECEIPT_KEY_LIST) &&
                   receipt.version === config.ESCROW_RECEIPT_VERSION &&
                   receipt.escrow_address_base === addressBase &&
                   receipt.node_id === this.getAddressFromPublicKey(terms.payee_public_key) &&
                   Number.isInteger(receipt.total_bytes) && receipt.total_bytes >= 0 &&
                   this._isPositiveInteger(receipt.sequence) &&
                   this._isPositiveInteger(receipt.receipt_date) &&
                   typeof receiptSignature === 'string' &&
                   signature.verify(objectHash.getHashBuffer(receipt), receiptSignature, terms.payer_public_key);
        }
        catch (e) {
            return false;
        }
    }

    /**
     * true if the transaction carries a signature by publicKey whose
     * signature address is the address of that key. the signatures
     * themselves are verified by isValidTransactionObject.
     */
    _isSignedBy(transaction, publicKey) {
        const addressBase = this.getAddressFromPublicKey(publicKey);
        return _.some(transaction.transaction_signature_list, transactionSignature =>
            transactionSignature.address_base === addressBase &&
            transactionSignature.address_attribute &&
            transactionSignature.address_attribute.key_public === publicKey);
    }

    /**
     * checks every escrow input of a transaction against the escrow rules.
     * must run after the transaction signatures were verified.
     * @param transaction
     * @param transactionDate unix time in seconds
     * @return {boolean}
     */
    isValidEscrowSpend(transaction, transactionDate) {
        const escrowInputList = _.filter(transaction.transaction_input_list, input => this.isEscrowAddressVersion(input.address_version));
        if (escrowInputList.length === 0) {
            return true;
        }

        // the terms and receipts travel in the output metadata, which is
        // only signed from transaction version 3. refresh transactions
        // cannot spend escrow outputs.
        const version       = transaction.version;
        const versionType   = version.charAt(1);
        const versionNumber = parseInt(version.substring(2, version.length - 1));
        if (versionType !== 'a' || !(versionNumber >= 3)) {
            return false;
        }

        const escrowList = transaction.transaction_output_attribute?.transaction_output_metadata?.escrow;
        if (!Array.isArray(escrowList)) {
            return false;
        }

        const addressBaseList = _.uniq(_.map(escrowInputList, input => input.address_base));
        if (escrowList.length !== addressBaseList.length) {
            return false;
        }

        try {
            return _.every(addressBaseList, addressBase => {
                const escrowEntryList = _.filter(escrowList, entry => _.isPlainObject(entry) && entry.address_base === addressBase);
                if (escrowEntryList.length !== 1) {
                    return false;
                }

                const escrowEntry = escrowEntryList[0];
                const terms       = escrowEntry.terms;
                if (!this.isValidTerms(terms) || this.getAddressBaseFromTerms(terms) !== addressBase ||
                    !_.every(escrowInputList, input => input.address_base !== addressBase || input.address_key_identifier === addressBase)) {
                    return false;
                }

                switch (escrowEntry.action) {
                    case ESCROW_ACTION_REFUND:
                        return transactionDate >= terms.unlock_date && this._isSignedBy(transaction, terms.payer_public_key);
                    case ESCROW_ACTION_CLOSE:
                        return this._isSignedBy(transaction, terms.payer_public_key) && this._isSignedBy(transaction, terms.payee_public_key);
                    case ESCROW_ACTION_CLAIM: {
                        if (!this._isSignedBy(transaction, terms.payee_public_key) ||
                            !this.isValidReceipt(terms, escrowEntry.receipt, escrowEntry.receipt_signature, addressBase)) {
                            return false;
                        }
                        // whatever the receipt does not cover goes back to
                        // the escrow address
                        const amountReturned = _.sum(_.map(_.filter(transaction.transaction_output_list, output =>
                            output.address_base === addressBase &&
                            output.address_version === config.ADDRESS_VERSION_ESCROW &&
                            output.address_key_identifier === addressBase), output => output.amount));
                        return amountReturned >= terms.amount - this.getEarnedAmount(terms, escrowEntry.receipt.total_bytes);
                    }
                    default:
                        return false;
                }
            });
        }
        catch (e) {
            return false;
        }
    }
}


export default new Escrow();
