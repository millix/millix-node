import _ from 'lodash';
import crypto from 'crypto';
import base58 from 'bs58';
import secp256k1 from 'secp256k1';
import config from '../config/config';
import database from '../../database/database';
import network from '../../net/network';
import wallet from './wallet';
import walletUtils from './wallet-utils';
import escrow, {ESCROW_ACTION_CLAIM, ESCROW_ACTION_REFUND} from './escrow';
import mutex from '../mutex';
import cache from '../cache';
import ntp from '../ntp';
import task from '../task';
import console from '../console';

export const ESCROW_ROLE_PAYER = 'payer';
export const ESCROW_ROLE_PAYEE = 'payee';

const ESCROW_STATUS_ACTIVE = 1;
const ESCROW_STATUS_DONE   = 2;


/**
 * builds and sends the transactions of the escrow flow for this node:
 * funding an escrow (payer), claiming the receipted portions (payee) and
 * the refund after the unlock date (payer). the rules every node checks are
 * in escrow.js.
 */
class WalletEscrow {

    _now() {
        return Math.floor(ntp.now().getTime() / 1000);
    }

    _getTransactionVersion() {
        // version 3 signs the output metadata that carries the escrow terms
        return config.MODE_TEST_NETWORK ? 'la3l' : '0a30';
    }

    _getOutputFee() {
        return {
            fee_type: 'transaction_fee_default',
            amount  : config.TRANSACTION_FEE_PROXY
        };
    }

    _watchEscrowAddress(addressBase) {
        // keep transactions of this escrow: they are not pruned and the
        // wallet syncs them like its own
        if (!config.EXTERNAL_WALLET_KEY_IDENTIFIER.includes(addressBase)) {
            config.EXTERNAL_WALLET_KEY_IDENTIFIER.push(addressBase);
        }
    }

    _getWalletAddress() {
        const addressVersion = database.getRepository('address').getDefaultAddressVersion().version;
        return {
            address_base          : wallet.defaultKeyIdentifier,
            address_version       : addressVersion,
            address_key_identifier: wallet.defaultKeyIdentifier
        };
    }

    /**
     * the pass key of an escrow is derived from this wallet's first key and
     * the escrow nonce, so it is never stored
     */
    getPassPrivateKey(nonce) {
        const extendedPrivateKey = wallet.getActiveWalletKey(wallet.getDefaultActiveWallet());
        if (!extendedPrivateKey) {
            throw Error('wallet_not_active');
        }
        const walletPrivateKey = walletUtils.derivePrivateKey(extendedPrivateKey, 0, 0);
        return crypto.createHmac('sha256', walletPrivateKey).update(`tangled-escrow-pass:${nonce}`).digest();
    }

    getPassPublicKey(passPrivateKey) {
        return base58.encode(Buffer.from(secp256k1.publicKeyCreate(passPrivateKey, true)));
    }

    /**
     * returns the unspent outputs held by an escrow address, as transaction
     * inputs
     */
    getEscrowInputList(terms) {
        const {address} = escrow.getEscrowAddress(terms);
        return database.applyShards(shardID => database.getRepository('transaction', shardID)
                                                       .listTransactionOutput({
                                                           'transaction_output.address': address,
                                                           'is_spent'                  : 0,
                                                           'is_double_spend'           : 0
                                                       }))
                       .then(outputList => _.filter(outputList, output => output.status !== 3 && output.transaction_status !== 3 &&
                                                                         !cache.getCacheItem('wallet', `is_spend_${output.transaction_id}_${output.output_position}`)))
                       .then(outputList => _.map(_.uniqBy(outputList, output => `${output.transaction_id}:${output.output_position}`), output => ({
                           output_transaction_id  : output.transaction_id,
                           output_position        : output.output_position,
                           output_transaction_date: output.transaction_date,
                           output_shard_id        : output.shard_id,
                           address_base           : output.address.substring(0, output.address.length - config.ADDRESS_VERSION_ESCROW.length - output.address_key_identifier.length),
                           address_version        : config.ADDRESS_VERSION_ESCROW,
                           address_key_identifier : output.address_key_identifier,
                           amount                 : output.amount
                       })));
    }

    /**
     * payer: locks amount millix in a new escrow for the payee
     * @param payeePublicKey the payee node public key
     * @param payeeNodeID
     * @param portionBytes
     * @param portionAmount
     * @param portionCount
     * @param unlockDate unix time in seconds
     * @return {Promise<{terms, escrow_address, pass_public_key, transaction}>}
     */
    createEscrow(payeePublicKey, payeeNodeID, portionBytes, portionAmount, portionCount, unlockDate) {
        if (escrow.getAddressFromPublicKey(payeePublicKey) !== payeeNodeID) {
            return Promise.reject('escrow_invalid_payee');
        }
        if (!escrow.isActive(this._now())) {
            return Promise.reject('escrow_not_active');
        }

        let terms, escrowAddress, passPublicKey;
        try {
            const nonce          = crypto.randomBytes(16).toString('hex');
            const passPrivateKey = this.getPassPrivateKey(nonce);
            passPublicKey        = this.getPassPublicKey(passPrivateKey);
            terms                = {
                version         : config.ESCROW_TERMS_VERSION,
                payer_public_key: passPublicKey,
                payee_public_key: payeePublicKey,
                amount          : portionAmount * portionCount,
                portion_bytes   : portionBytes,
                portion_amount  : portionAmount,
                unlock_date     : unlockDate,
                nonce
            };
            escrowAddress        = escrow.getEscrowAddress(terms);
        }
        catch (e) {
            return Promise.reject(e.message || e);
        }

        if (!escrow.isValidTerms(terms)) {
            return Promise.reject('escrow_invalid_terms');
        }

        const escrowRepository = database.getRepository('escrow');
        this._watchEscrowAddress(escrowAddress.address_base);
        return escrowRepository.addEscrow(escrowAddress.address, escrowAddress.address_base, ESCROW_ROLE_PAYER, payeeNodeID, terms)
                               .then(() => wallet.addTransaction([
                                   {
                                       ..._.pick(escrowAddress, [
                                           'address_base',
                                           'address_version',
                                           'address_key_identifier'
                                       ]),
                                       amount: terms.amount
                                   }
                               ], this._getOutputFee()))
                               .then(transactionList => {
                                   const transaction = _.last(transactionList);
                                   console.log(`[wallet-escrow] funded escrow ${escrowAddress.address} with ${terms.amount} in transaction ${transaction.transaction_id}`);
                                   return escrowRepository.updateFundingTransaction(escrowAddress.address_base, transaction.transaction_id)
                                                          .then(() => ({
                                                              terms,
                                                              escrow_address : escrowAddress.address,
                                                              pass_public_key: passPublicKey,
                                                              transaction
                                                          }));
                               });
    }

    requestFundingTransaction(fundingTransactionID) {
        if (fundingTransactionID) {
            wallet.requestTransactionFromNetwork(fundingTransactionID, {
                priority        : 1,
                dispatch_request: true
            });
        }
    }

    /**
     * payee: records a funded escrow that pays this node
     */
    addPayeeEscrow(terms, fundingTransactionID) {
        const escrowAddress = escrow.getEscrowAddress(terms);
        this._watchEscrowAddress(escrowAddress.address_base);
        return database.getRepository('escrow')
                       .addEscrow(escrowAddress.address, escrowAddress.address_base, ESCROW_ROLE_PAYEE, network.nodeID, terms, fundingTransactionID)
                       .then(() => database.getRepository('escrow').getEscrow(escrowAddress.address_base));
    }

    /**
     * the millix earned by the latest receipt that are still in the escrow
     */
    getClaimableAmount(escrowRecord, inputList) {
        const amountLocked   = _.sum(_.map(inputList, input => input.amount));
        const amountReleased = escrowRecord.terms.amount - amountLocked;
        return escrow.getEarnedAmount(escrowRecord.terms, escrowRecord.receipt_total_bytes) - amountReleased;
    }

    _sendEscrowTransaction(inputList, outputList, signer, escrowEntry) {
        const addressAttributeMap = {[signer.address_base]: {key_public: signer.public_key}};
        const privateKeyMap       = {[signer.address_base]: signer.private_key.toString('hex')};
        return wallet.processTransaction(() => wallet.signAndStoreTransaction(inputList, outputList, this._getOutputFee(), addressAttributeMap, privateKeyMap,
            this._getTransactionVersion(), {escrow: [escrowEntry]}, false, [signer.address_base]))
                     .then(transactionList => _.last(transactionList));
    }

    /**
     * payee: takes the portions earned by the latest receipt and returns the
     * rest of the escrow to the escrow address
     */
    claim(addressBase, amountMin = config.TRANSACTION_FEE_PROXY + 1) {
        return new Promise((resolve, reject) => {
            mutex.lock([`escrow_${addressBase}`], unlock => {
                const escrowRepository = database.getRepository('escrow');
                escrowRepository.getEscrow(addressBase)
                                .then(escrowRecord => {
                                    if (!escrowRecord || escrowRecord.role !== ESCROW_ROLE_PAYEE) {
                                        return Promise.reject('escrow_not_found');
                                    }
                                    if (!escrowRecord.receipt) {
                                        return Promise.reject('escrow_receipt_not_found');
                                    }
                                    return this.getEscrowInputList(escrowRecord.terms).then(inputList => [
                                        escrowRecord,
                                        inputList
                                    ]);
                                })
                                .then(([escrowRecord, inputList]) => {
                                    if (inputList.length === 0) {
                                        return Promise.reject('escrow_output_not_found');
                                    }
                                    const amountLocked    = _.sum(_.map(inputList, input => input.amount));
                                    const amountClaimable = this.getClaimableAmount(escrowRecord, inputList);
                                    if (amountClaimable < amountMin) {
                                        return Promise.reject('escrow_claim_amount_too_small');
                                    }

                                    const outputList = [
                                        {
                                            ...this._getWalletAddress(),
                                            amount: amountClaimable - config.TRANSACTION_FEE_PROXY
                                        }
                                    ];
                                    if (amountLocked - amountClaimable > 0) {
                                        outputList.push({
                                            ..._.pick(escrow.getEscrowAddress(escrowRecord.terms), [
                                                'address_base',
                                                'address_version',
                                                'address_key_identifier'
                                            ]),
                                            amount: amountLocked - amountClaimable
                                        });
                                    }

                                    return this._sendEscrowTransaction(inputList, outputList, {
                                        address_base: network.nodeID,
                                        public_key  : network.nodePublicKey,
                                        private_key : network.nodePrivateKey.toBuffer()
                                    }, {
                                        address_base     : addressBase,
                                        action           : ESCROW_ACTION_CLAIM,
                                        terms            : escrowRecord.terms,
                                        receipt          : escrowRecord.receipt,
                                        receipt_signature: escrowRecord.receipt_signature
                                    }).then(transaction => {
                                        console.log(`[wallet-escrow] claimed ${amountClaimable} from escrow ${addressBase} for ${escrowRecord.receipt_total_bytes} receipted bytes in transaction ${transaction.transaction_id}`);
                                        return (amountLocked === amountClaimable ? escrowRepository.updateStatus(addressBase, ESCROW_STATUS_DONE) : Promise.resolve())
                                            .then(() => ({
                                                transaction,
                                                amount_claimed : amountClaimable,
                                                amount_returned: amountLocked - amountClaimable
                                            }));
                                    });
                                })
                                .then(result => {
                                    unlock();
                                    resolve(result);
                                })
                                .catch(e => {
                                    unlock();
                                    reject(e?.error || e);
                                });
            });
        });
    }

    /**
     * payer: after the unlock date, takes back what is left in the escrow
     */
    refund(addressBase) {
        return new Promise((resolve, reject) => {
            mutex.lock([`escrow_${addressBase}`], unlock => {
                const escrowRepository = database.getRepository('escrow');
                escrowRepository.getEscrow(addressBase)
                                .then(escrowRecord => {
                                    if (!escrowRecord || escrowRecord.role !== ESCROW_ROLE_PAYER) {
                                        return Promise.reject('escrow_not_found');
                                    }
                                    if (this._now() < escrowRecord.terms.unlock_date) {
                                        return Promise.reject('escrow_locked');
                                    }
                                    return this.getEscrowInputList(escrowRecord.terms).then(inputList => [
                                        escrowRecord,
                                        inputList
                                    ]);
                                })
                                .then(([escrowRecord, inputList]) => {
                                    const amountLocked = _.sum(_.map(inputList, input => input.amount));
                                    if (amountLocked <= config.TRANSACTION_FEE_PROXY) {
                                        return escrowRepository.updateStatus(addressBase, ESCROW_STATUS_DONE)
                                                               .then(() => Promise.reject('escrow_output_not_found'));
                                    }

                                    const passPrivateKey = this.getPassPrivateKey(escrowRecord.terms.nonce);
                                    const passPublicKey  = this.getPassPublicKey(passPrivateKey);
                                    return this._sendEscrowTransaction(inputList, [
                                        {
                                            ...this._getWalletAddress(),
                                            amount: amountLocked - config.TRANSACTION_FEE_PROXY
                                        }
                                    ], {
                                        address_base: escrow.getAddressFromPublicKey(passPublicKey),
                                        public_key  : passPublicKey,
                                        private_key : passPrivateKey
                                    }, {
                                        address_base: addressBase,
                                        action      : ESCROW_ACTION_REFUND,
                                        terms       : escrowRecord.terms
                                    }).then(transaction => {
                                        console.log(`[wallet-escrow] refunded ${amountLocked} from escrow ${addressBase} in transaction ${transaction.transaction_id}`);
                                        return escrowRepository.updateStatus(addressBase, ESCROW_STATUS_DONE)
                                                               .then(() => ({
                                                                   transaction,
                                                                   amount_refunded: amountLocked
                                                               }));
                                    });
                                })
                                .then(result => {
                                    unlock();
                                    resolve(result);
                                })
                                .catch(e => {
                                    unlock();
                                    reject(e?.error || e);
                                });
            });
        });
    }

    /**
     * payee: stores a receipt signed by the payer's pass key if it moves the
     * escrow forward
     * @return {Promise<boolean>}
     */
    addReceipt(escrowRecord, receipt, receiptSignature) {
        if (!escrow.isValidReceipt(escrowRecord.terms, receipt, receiptSignature, escrowRecord.address_base)) {
            return Promise.resolve(false);
        }
        return database.getRepository('escrow').updateReceipt(escrowRecord.address_base, receipt, receiptSignature);
    }

    getEscrowStatus(addressBase) {
        return database.getRepository('escrow')
                       .getEscrow(addressBase)
                       .then(escrowRecord => {
                           if (!escrowRecord) {
                               return Promise.reject('escrow_not_found');
                           }
                           return this.getEscrowInputList(escrowRecord.terms).then(inputList => {
                               const amountLocked = _.sum(_.map(inputList, input => input.amount));
                               return {
                                   ..._.omit(escrowRecord, ['receipt_signature']),
                                   amount_locked   : amountLocked,
                                   amount_released : escrowRecord.terms.amount - amountLocked,
                                   amount_earned   : escrow.getEarnedAmount(escrowRecord.terms, escrowRecord.receipt_total_bytes),
                                   amount_claimable: escrowRecord.role === ESCROW_ROLE_PAYEE ? Math.max(0, this.getClaimableAmount(escrowRecord, inputList)) : 0,
                                   output_list     : inputList
                               };
                           });
                       });
    }

    /**
     * claims for the payee when enough has been earned, and refunds the payer
     * when an escrow unlocks
     */
    _doEscrowSettlement() {
        const escrowRepository = database.getRepository('escrow');
        const now              = this._now();
        return escrowRepository.listEscrow({status: ESCROW_STATUS_ACTIVE})
                               .then(escrowList => {
                                   let pipeline = Promise.resolve();
                                   escrowList.forEach(escrowRecord => {
                                       if (escrowRecord.role === ESCROW_ROLE_PAYEE && escrowRecord.receipt) {
                                           // claim in larger steps to spend less on fees, and
                                           // everything earned before the payer can take it back
                                           const isUnlockNear = escrowRecord.terms.unlock_date - now < config.ESCROW_CLAIM_BEFORE_UNLOCK;
                                           pipeline           = pipeline.then(() => this.claim(escrowRecord.address_base, isUnlockNear ? config.TRANSACTION_FEE_PROXY + 1 : config.ESCROW_CLAIM_AMOUNT_MIN))
                                                                        .catch(_ => _);
                                       }
                                       else if (escrowRecord.role === ESCROW_ROLE_PAYER && now >= escrowRecord.terms.unlock_date) {
                                           pipeline = pipeline.then(() => this.refund(escrowRecord.address_base))
                                                              .catch(_ => _);
                                       }
                                   });
                                   return pipeline;
                               });
    }

    initialize() {
        return database.getRepository('escrow')
                       .listEscrow({status: ESCROW_STATUS_ACTIVE})
                       .then(escrowList => escrowList.forEach(escrowRecord => this._watchEscrowAddress(escrowRecord.address_base)))
                       .then(() => task.scheduleTask('escrow_settlement', this._doEscrowSettlement.bind(this), config.ESCROW_TASK_WAIT_TIME, true));
    }

    stop() {
        task.removeTask('escrow_settlement');
    }
}


export default new WalletEscrow();
