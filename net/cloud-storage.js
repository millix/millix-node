import _ from 'lodash';
import config from '../core/config/config';
import database from '../database/database';
import network from './network';
import cloudOffer from './cloud-offer';
import escrow from '../core/wallet/escrow';
import walletEscrow, {ESCROW_ROLE_PAYEE, ESCROW_ROLE_PAYER} from '../core/wallet/wallet-escrow';
import mutex from '../core/mutex';
import ntp from '../core/ntp';
import console from '../core/console';

const COPY_ID_PATTERN = /^[0-9a-f]{32}$/;


/**
 * storage paid through an escrow: the rent follows the proofs, it is not
 * paid before them.
 *
 * the storage service is not part of the node. it keeps the files, asks and
 * answers the proofs (the renter sends a challenge for 1,024 bytes of the
 * copy every CLOUD_STORAGE_PROOF_INTERVAL and knows the answer) and carries
 * the receipts between renter and host. this module is the money side, the
 * sibling of the vpn receipts (vpn-client.js signs them, vpn-exit.js takes
 * them): the same escrow, the same claim and the same refund.
 *
 * - the renter opens an escrow for the rent of one rental period of one copy
 *   at the host of a storage_host offer (openRental, which funds it with
 *   walletEscrow.createEscrow). a portion is one proof interval:
 *   portion_bytes is CLOUD_STORAGE_PROOF_BYTES, the bytes a proof checks,
 *   portion_amount the rent of the copy for one interval, and the amount
 *   pays every interval of the period.
 * - after every proof the renter signs a storage receipt (signReceipt): the
 *   escrow receipt with the copy, the period covered and the amount earned.
 *   a passed proof adds the portions of the proof intervals that ended since
 *   the proof before it, at most CLOUD_STORAGE_PROOF_PORTION_MAX; a missed
 *   proof adds nothing and moves the period on, so the time up to it is
 *   never paid later. receipts are cumulative: the host needs only the
 *   latest one.
 * - the host takes each receipt (addReceipt). the first one makes the escrow
 *   known to it, once funded, and ties it to the copy. the host claims with
 *   the latest receipt (walletEscrow.claim, and the settlement task before
 *   the unlock date); what the passed proofs did not earn returns to the
 *   renter after the unlock date (walletEscrow.refund).
 *
 * a receipt is signed after every proof, not every few: signing costs no
 * transaction and the host keeps one receipt, so waiting would only raise
 * what an honest host can lose, which is the rent since the latest receipt.
 *
 * the storage receipt, signed by the pass key of the escrow (the payer key
 * of its terms) like every escrow receipt:
 *
 *   version              ESCROW_RECEIPT_VERSION
 *   escrow_address_base  the escrow
 *   node_id              the host: the node id of the terms' payee key
 *   copy_id              the copy at the host, 32 hex characters
 *   period_start         when the rental began, unix time in seconds
 *   period_end           the date of the latest proof the receipt counts,
 *                        passed or missed
 *   total_bytes          the bytes proven so far: portion_bytes for each
 *                        proof interval earned
 *   total_amount         the millix earned so far: what total_bytes earns by
 *                        the terms, never more than the escrow amount
 *   sequence             1 for the first receipt, one more for each next
 *   receipt_date         when it was signed
 *
 * every node checks it in a claim (escrow.isValidReceipt), so a claim
 * cannot take more than total_amount.
 *
 * what this does not protect against:
 *
 * - a renter who stops signing. the host is honest and answers, and loses
 *   the rent since the latest receipt: one proof interval if its storage
 *   service stops answering as soon as a receipt does not follow a proof,
 *   more if it keeps the copy without receipts. the node cannot stop it: the
 *   storage service must. a renter who asks no proofs at all pays nothing
 *   for that time either.
 * - a renter who says a proof failed when it passed. only the renter knows
 *   the answers, so nobody else can check a proof, and the escrow rules
 *   every node applies check the renter's signature, not the proof. the
 *   node does not see proofs: it signs what its storage service reports.
 * - a host that answers proofs but refuses fetches, or serves them slowly.
 *   a proof shows the host has 1,024 bytes of the copy at that moment, not
 *   that it will hand the file over. fetches are not paid through this
 *   escrow.
 * - a host that keeps most of a copy, or gets the challenged bytes from
 *   another host of the same file in time: a proof checks one place.
 * - a host that kept the answers. the storage service works its challenges
 *   out before the upload; if it asks one again, a host that stored the
 *   answer passes without the copy. challenges must not repeat.
 * - a host that claims late. as for the vpn, what is not claimed before the
 *   unlock date can be taken back by the renter, earned or not.
 * - the price. the node checks that the escrow pays this node, is funded
 *   and that its receipts are signed. whether portion_amount is the host's
 *   price for a copy of that size is for the storage service, which knows
 *   the size, to check before it keeps the copy.
 * - fees on small rentals. the renter pays a fee to fund the escrow and one
 *   to take back what is left, the host one for each claim, and a new
 *   period needs a new escrow. a rent of a few fees goes mostly to fees; a
 *   rent that is not more than one fee is refused. the rent of a proof
 *   interval is rounded up to a whole millix.
 *
 * what more would need: for fetches, an escrow paid by receipts for bytes
 * delivered (the vpn's receipt already is that) and copies at more than one
 * host. for disputes, proofs anyone can check: the escrow terms would
 * commit to a hash tree of the copy, the challenge would come from
 * something neither side picks (a later transaction's id), and a claim
 * would carry the proof in place of the renter's signature.
 */
class CloudStorage {

    _now() {
        return Math.floor(ntp.now().getTime() / 1000);
    }

    _isPositiveInteger(value) {
        return Number.isSafeInteger(value) && value > 0;
    }

    /**
     * one receipt at a time for an escrow, and not during its claim or
     * refund: each receipt builds on the one before
     */
    _lock(addressBase, proc) {
        return new Promise((resolve, reject) => {
            mutex.lock([`escrow_${addressBase}`], unlock => {
                proc().then(result => {
                    unlock();
                    resolve(result);
                }).catch(e => {
                    unlock();
                    reject(e);
                });
            });
        });
    }

    /**
     * the rent of a copy for one proof interval, in whole millix rounded up
     * @param sizeBytes the size of the copy
     * @param priceGbHour millix for a GB of CLOUD_STORAGE_GB_BYTES kept an
     *     hour
     */
    getPortionAmount(sizeBytes, priceGbHour) {
        const rent = BigInt(sizeBytes) * BigInt(priceGbHour) * BigInt(config.CLOUD_STORAGE_PROOF_INTERVAL);
        const unit = BigInt(config.CLOUD_STORAGE_GB_BYTES) * BigInt(3600);
        return Number((rent + unit - BigInt(1)) / unit);
    }

    /**
     * renter: locks the rent of one rental period of a copy in an escrow for
     * the host of a storage_host offer, and signs the first receipt, which
     * names the copy and has earned nothing
     * @param offerID
     * @param copyID the id of the copy at the host, 32 hex characters
     * @param sizeBytes the size of the copy
     * @param period the rental period in seconds
     * @return {Promise<{escrow_address, escrow_address_base, terms, funding_transaction_id, copy_id, period_start, period_end, proof_interval, receipt, receipt_signature}>}
     */
    openRental(offerID, copyID, sizeBytes, period) {
        if (typeof copyID !== 'string' || !COPY_ID_PATTERN.test(copyID)) {
            return Promise.reject('storage_copy_id_invalid');
        }
        if (!this._isPositiveInteger(sizeBytes)) {
            return Promise.reject('storage_size_invalid');
        }
        if (!this._isPositiveInteger(period)) {
            return Promise.reject('storage_period_invalid');
        }

        const escrowRepository = database.getRepository('escrow');
        const interval         = config.CLOUD_STORAGE_PROOF_INTERVAL;
        const periodStart      = this._now();
        return database.getRepository('cloud_offer')
                       .getOfferByID(offerID)
                       .then(offer => {
                           if (!offer) {
                               return Promise.reject('offer_not_found');
                           }
                           const {
                                     valid,
                                     reason
                                 } = cloudOffer.verifyOffer(offer);
                           if (!valid) {
                               return Promise.reject(reason);
                           }
                           if (offer.service !== 'storage_host') {
                               return Promise.reject('offer_not_storage_host');
                           }
                           if (cloudOffer.isNodeOnly(offer)) {
                               return Promise.reject('offer_node_only');
                           }
                           if (period < offer.storage.rental_period_min) {
                               return Promise.reject('storage_period_too_short');
                           }

                           const portionCount  = Math.ceil(period / interval);
                           const unlockDate    = periodStart + portionCount * interval + config.CLOUD_STORAGE_ESCROW_UNLOCK_AFTER;
                           if (unlockDate - periodStart > config.ESCROW_UNLOCK_DURATION_MAX) {
                               return Promise.reject('storage_period_too_long');
                           }
                           const portionAmount = this.getPortionAmount(sizeBytes, offer.storage.price_gb_hour);
                           if (!Number.isSafeInteger(portionAmount * portionCount)) {
                               return Promise.reject('storage_rent_invalid');
                           }
                           // the host pays a fee to claim: a rent that is
                           // not more than the fee can never be claimed
                           if (portionAmount * portionCount <= config.TRANSACTION_FEE_PROXY) {
                               return Promise.reject('storage_rent_below_fee');
                           }

                           return walletEscrow.createEscrow(offer.node_public_key, offer.node_id, config.CLOUD_STORAGE_PROOF_BYTES, portionAmount, portionCount, unlockDate)
                                              .then(escrowData => [
                                                  offer,
                                                  escrowData,
                                                  portionCount
                                              ]);
                       })
                       .then(([offer, escrowData, portionCount]) => {
                           const escrowAddress    = escrow.getEscrowAddress(escrowData.terms);
                           const receipt          = {
                               version            : config.ESCROW_RECEIPT_VERSION,
                               escrow_address_base: escrowAddress.address_base,
                               node_id            : offer.node_id,
                               copy_id            : copyID,
                               period_start       : periodStart,
                               period_end         : periodStart,
                               total_bytes        : 0,
                               total_amount       : 0,
                               sequence           : 1,
                               receipt_date       : periodStart
                           };
                           const receiptSignature = escrow.signReceipt(receipt, walletEscrow.getPassPrivateKey(escrowData.terms.nonce));
                           return escrowRepository.updateReceipt(escrowAddress.address_base, receipt, receiptSignature)
                                                  .then(stored => {
                                                      if (!stored) {
                                                          return Promise.reject('receipt_not_stored');
                                                      }
                                                      console.log(`[cloud-storage] opened escrow ${escrowAddress.address} for copy ${copyID} at host ${offer.node_id}: ${portionCount} proof intervals at ${escrowData.terms.portion_amount} each`);
                                                      return {
                                                          escrow_address        : escrowAddress.address,
                                                          escrow_address_base   : escrowAddress.address_base,
                                                          terms                 : escrowData.terms,
                                                          funding_transaction_id: escrowData.transaction.transaction_id,
                                                          copy_id               : copyID,
                                                          period_start          : periodStart,
                                                          period_end            : periodStart + portionCount * interval,
                                                          proof_interval        : interval,
                                                          receipt,
                                                          receipt_signature     : receiptSignature
                                                      };
                                                  });
                       });
    }

    /**
     * renter: signs the next receipt of a rental after a proof. a passed
     * proof earns the host the portions of the proof intervals that ended
     * since the proof before it, at most CLOUD_STORAGE_PROOF_PORTION_MAX. a
     * missed proof earns nothing: its receipt only moves the period on. a
     * second proof in the same interval is not due.
     * @param addressBase the escrow address base
     * @param proofPassed true if the host answered the proof correctly
     * @return {Promise<{receipt, receipt_signature, amount, amount_earned}>}
     */
    signReceipt(addressBase, proofPassed) {
        return this._lock(addressBase, () => this._signReceipt(addressBase, proofPassed));
    }

    _signReceipt(addressBase, proofPassed) {
        const escrowRepository = database.getRepository('escrow');
        return escrowRepository.getEscrow(addressBase)
                               .then(escrowRecord => {
                                   if (!escrowRecord || escrowRecord.role !== ESCROW_ROLE_PAYER) {
                                       return Promise.reject('escrow_not_found');
                                   }
                                   const terms    = escrowRecord.terms;
                                   const previous = escrowRecord.receipt;
                                   if (!escrow.isStorageReceipt(previous)) {
                                       return Promise.reject('escrow_not_storage');
                                   }
                                   const now = this._now();
                                   if (now >= terms.unlock_date) {
                                       return Promise.reject('escrow_unlocked');
                                   }

                                   // the proof intervals of the rental
                                   // period that have ended at a date
                                   const intervalCount         = Math.floor(terms.amount / terms.portion_amount);
                                   const getIntervalCountEnded = date => Math.min(intervalCount, Math.floor((date - previous.period_start) / config.CLOUD_STORAGE_PROOF_INTERVAL));
                                   const intervalCountDue      = getIntervalCountEnded(now) - getIntervalCountEnded(previous.period_end);
                                   if (intervalCountDue <= 0) {
                                       return Promise.reject('storage_receipt_not_due');
                                   }

                                   const portionCount = proofPassed === true ? Math.min(intervalCountDue, config.CLOUD_STORAGE_PROOF_PORTION_MAX) : 0;
                                   const totalBytes   = previous.total_bytes + portionCount * terms.portion_bytes;
                                   let receipt, receiptSignature;
                                   try {
                                       receipt          = {
                                           ...previous,
                                           period_end  : now,
                                           total_bytes : totalBytes,
                                           total_amount: escrow.getEarnedAmount(terms, totalBytes),
                                           sequence    : previous.sequence + 1,
                                           receipt_date: now
                                       };
                                       receiptSignature = escrow.signReceipt(receipt, walletEscrow.getPassPrivateKey(terms.nonce));
                                   }
                                   catch (e) {
                                       return Promise.reject(e.message || e);
                                   }

                                   return escrowRepository.updateReceipt(addressBase, receipt, receiptSignature)
                                                          .then(stored => {
                                                              if (!stored) {
                                                                  return Promise.reject('receipt_not_stored');
                                                              }
                                                              return {
                                                                  receipt,
                                                                  receipt_signature: receiptSignature,
                                                                  amount           : terms.amount,
                                                                  amount_earned    : receipt.total_amount
                                                              };
                                                          });
                               });
    }

    /**
     * host: records a funded escrow that pays this node for a copy, from
     * its terms and the first receipt the host is given
     */
    _addRental(terms, receipt, fundingTransactionID) {
        const now = this._now();
        if (!escrow.isActive(now)) {
            return Promise.reject('escrow_not_active');
        }
        if (terms.unlock_date <= now || terms.unlock_date - now > config.ESCROW_UNLOCK_DURATION_MAX) {
            return Promise.reject('escrow_unlock_date_not_accepted');
        }

        return walletEscrow.getEscrowInputList(terms)
                           .then(inputList => {
                               const amountLocked = _.sum(_.map(inputList, input => input.amount));
                               // what has not been earned yet must still be
                               // locked in the escrow. the escrow is only
                               // recorded once it is funded.
                               if (inputList.length === 0 || amountLocked < terms.amount - receipt.total_amount) {
                                   walletEscrow.requestFundingTransaction(fundingTransactionID);
                                   return Promise.reject('escrow_not_funded');
                               }
                               return walletEscrow.addPayeeEscrow(terms, fundingTransactionID);
                           })
                           .then(escrowRecord => {
                               console.log(`[cloud-storage] escrow ${escrowRecord.escrow_address} pays this node for copy ${receipt.copy_id}: ${terms.amount} locked until ${terms.unlock_date}`);
                               return escrowRecord;
                           });
    }

    /**
     * host: takes a storage receipt signed by the renter's pass key. the
     * first receipt of an escrow records the escrow, once it is funded, and
     * ties it to the receipt's copy and period start; every later one must
     * name the same copy and move the escrow forward.
     * @param terms the escrow terms
     * @param receipt
     * @param receiptSignature
     * @param fundingTransactionID asked from the network when the escrow's
     *     funding has not reached this node yet
     * @return {Promise<{escrow_address, escrow_address_base, copy_id, period_start, period_end, receipt_sequence, receipt_total_bytes, amount, portion_amount, amount_earned, unlock_date}>}
     */
    addReceipt(terms, receipt, receiptSignature, fundingTransactionID) {
        if (!escrow.isValidTerms(terms)) {
            return Promise.reject('escrow_invalid_terms');
        }
        if (terms.payee_public_key !== network.nodePublicKey) {
            return Promise.reject('escrow_not_for_this_node');
        }

        const escrowAddress = escrow.getEscrowAddress(terms);
        if (!escrow.isStorageReceipt(receipt) || !escrow.isValidReceipt(terms, receipt, receiptSignature, escrowAddress.address_base)) {
            return Promise.reject('receipt_not_accepted');
        }

        return this._lock(escrowAddress.address_base, () => this._addReceipt(escrowAddress, terms, receipt, receiptSignature, fundingTransactionID));
    }

    _addReceipt(escrowAddress, terms, receipt, receiptSignature, fundingTransactionID) {
        return database.getRepository('escrow')
                       .getEscrow(escrowAddress.address_base)
                       .then(escrowRecord => escrowRecord || this._addRental(terms, receipt, typeof fundingTransactionID === 'string' ? fundingTransactionID : undefined))
                       .then(escrowRecord => {
                           if (escrowRecord.role !== ESCROW_ROLE_PAYEE) {
                               return Promise.reject('escrow_not_found');
                           }
                           const latest = escrowRecord.receipt;
                           if (latest && (latest.copy_id !== receipt.copy_id || latest.period_start !== receipt.period_start)) {
                               return Promise.reject('receipt_not_for_this_copy');
                           }
                           // a replayed or older receipt changes nothing
                           if (receipt.sequence <= escrowRecord.receipt_sequence || receipt.total_bytes < escrowRecord.receipt_total_bytes) {
                               return Promise.reject('receipt_not_newer');
                           }
                           return walletEscrow.addReceipt(escrowRecord, receipt, receiptSignature);
                       })
                       .then(stored => {
                           if (!stored) {
                               return Promise.reject('receipt_not_newer');
                           }
                           return {
                               escrow_address     : escrowAddress.address,
                               escrow_address_base: escrowAddress.address_base,
                               copy_id            : receipt.copy_id,
                               period_start       : receipt.period_start,
                               period_end         : receipt.period_end,
                               receipt_sequence   : receipt.sequence,
                               receipt_total_bytes: receipt.total_bytes,
                               amount             : terms.amount,
                               portion_amount     : terms.portion_amount,
                               amount_earned      : receipt.total_amount,
                               unlock_date        : terms.unlock_date
                           };
                       });
    }
}


export default new CloudStorage();
