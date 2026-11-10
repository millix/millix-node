import {Database} from '../database';

/**
 * the broker's records: the certificates it issued (passes and trials), the
 * latest receipt of each exit node for each certificate, the exit nodes it
 * pays, its payouts and the exit nodes its trial does not extend to
 */
export default class CloudBroker {
    constructor(database) {
        this.database = database;
    }

    _run(sql, parameters) {
        return new Promise((resolve, reject) => {
            this.database.run(sql, parameters, err => err ? reject(err.message || err) : resolve());
        });
    }

    _get(sql, parameters) {
        return new Promise((resolve, reject) => {
            this.database.get(sql, parameters, (err, row) => {
                if (err) {
                    return reject(err.message || err);
                }
                resolve(row);
            });
        });
    }

    _all(sql, parameters) {
        return new Promise((resolve, reject) => {
            this.database.all(sql, parameters, (err, rows) => {
                if (err) {
                    return reject(err.message || err);
                }
                resolve(rows);
            });
        });
    }

    _parseCertificate(row) {
        return row ? {
            ...row,
            certificate: JSON.parse(row.certificate)
        } : row;
    }

    /**
     * @param certificate
     * @param paymentAmount what the payment of a pass paid the broker (null
     * for a trial)
     */
    addCertificate(certificate, paymentAmount = null) {
        return this._run('INSERT OR IGNORE INTO cloud_broker_certificate (certificate_id, funding_transaction_id, holder_public_key, certificate, end_date, is_trial, payment_amount) VALUES (?,?,?,?,?,?,?)', [
            certificate.certificate_id,
            certificate.funding_transaction_id,
            certificate.holder_public_key,
            JSON.stringify(certificate),
            certificate.end_date,
            certificate.trial === true ? 1 : 0,
            paymentAmount
        ]);
    }

    getCertificate(certificateID) {
        return this._get('SELECT * FROM cloud_broker_certificate WHERE certificate_id = ?', [certificateID]).then(row => this._parseCertificate(row));
    }

    getCertificateByFundingTransaction(fundingTransactionID) {
        return this._get('SELECT * FROM cloud_broker_certificate WHERE funding_transaction_id = ?', [fundingTransactionID]).then(row => this._parseCertificate(row));
    }

    updatePieceIssuedCount(certificateID, pieceIssuedCount) {
        return this._run('UPDATE cloud_broker_certificate SET piece_issued_count = MAX(piece_issued_count, ?) WHERE certificate_id = ?', [
            pieceIssuedCount,
            certificateID
        ]);
    }

    getReceipt(certificateID, nodeID) {
        return this._get('SELECT * FROM cloud_broker_receipt WHERE certificate_id = ? AND node_id = ?', [
            certificateID,
            nodeID
        ]);
    }

    /**
     * stores the receipt if it moves the certificate forward at that node
     * @return {Promise<boolean>}
     */
    upsertReceipt(certificateID, nodeID, receipt, receiptSignature, now) {
        return this.getReceipt(certificateID, nodeID)
                   .then(stored => {
                       if (stored && (stored.sequence >= receipt.sequence || stored.total_bytes > receipt.total_bytes)) {
                           return false;
                       }
                       return this._upsertReceipt(certificateID, nodeID, receipt, receiptSignature, now).then(() => true);
                   });
    }

    _upsertReceipt(certificateID, nodeID, receipt, receiptSignature, now) {
        return this._run(`INSERT INTO cloud_broker_receipt (certificate_id, node_id, piece_index, total_bytes, sequence, receipt, receipt_signature, first_receipt_date, update_date)
                          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
                          ON CONFLICT (certificate_id, node_id) DO UPDATE SET piece_index = ?3, total_bytes = ?4, sequence = ?5, receipt = ?6, receipt_signature = ?7, update_date = ?8
                          WHERE sequence < ?5 AND total_bytes <= ?4`, [
            certificateID,
            nodeID,
            receipt.piece_index,
            receipt.total_bytes,
            receipt.sequence,
            JSON.stringify(receipt),
            receiptSignature,
            now
        ]);
    }

    /**
     * every receipt with the data of its certificate, oldest first for each
     * certificate
     */
    listReceiptWithCertificate() {
        return this._all(`SELECT cloud_broker_receipt.certificate_id, cloud_broker_receipt.node_id, cloud_broker_receipt.total_bytes,
                                 cloud_broker_receipt.first_receipt_date, cloud_broker_receipt.update_date, cloud_broker_certificate.is_trial,
                                 cloud_broker_certificate.certificate
                          FROM cloud_broker_receipt
                                   INNER JOIN cloud_broker_certificate ON cloud_broker_receipt.certificate_id = cloud_broker_certificate.certificate_id
                          ORDER BY cloud_broker_receipt.certificate_id, cloud_broker_receipt.first_receipt_date, cloud_broker_receipt.node_id`, [])
                   .then(rows => rows.map(row => ({
                       ...row,
                       data_bytes: JSON.parse(row.certificate).data_bytes,
                       certificate: undefined
                   })));
    }

    upsertHost(nodeID, payoutAddress, now) {
        return this._run(`INSERT INTO cloud_broker_host (node_id, payout_address, update_date) VALUES (?1, ?2, ?3)
                          ON CONFLICT (node_id) DO UPDATE SET payout_address = ?2, update_date = ?3`, [
            nodeID,
            payoutAddress,
            now
        ]);
    }

    listHost(where, orderBy, limit) {
        const {
                  sql,
                  parameters
              } = Database.buildQuery('SELECT * FROM cloud_broker_host', where, orderBy, limit);
        return this._all(sql, parameters);
    }

    /**
     * records a payout transaction and what it paid each exit node
     * @param transactionID
     * @param paymentList [{node_id, amount, amount_trial}]: amount_trial is
     * the part of amount paid for trial traffic
     */
    addPayout(transactionID, paymentList, now) {
        return paymentList.reduce((pipeline, payment) => pipeline
            .then(() => this._run('INSERT INTO cloud_broker_payout (transaction_id, node_id, amount, amount_trial, create_date) VALUES (?,?,?,?,?)', [
                transactionID,
                payment.node_id,
                payment.amount,
                payment.amount_trial || 0,
                now
            ]))
            .then(() => this._run('UPDATE cloud_broker_host SET amount_paid = amount_paid + ?, amount_paid_trial = amount_paid_trial + ?, update_date = ? WHERE node_id = ?', [
                payment.amount,
                payment.amount_trial || 0,
                now,
                payment.node_id
            ])), Promise.resolve());
    }

    listTrialBlock() {
        return this._all('SELECT * FROM cloud_broker_trial_block ORDER BY create_date, node_id', []);
    }

    isTrialBlocked(nodeID) {
        return this._get('SELECT node_id FROM cloud_broker_trial_block WHERE node_id = ?', [nodeID]).then(row => !!row);
    }

    /**
     * replaces the exit nodes the trial does not extend to. nodes already on
     * the list keep the date they were added.
     * @param nodeIDList
     */
    setTrialBlockList(nodeIDList, now) {
        return this._run(`DELETE FROM cloud_broker_trial_block WHERE node_id NOT IN (${nodeIDList.map(() => '?').join(',')})`, nodeIDList)
                   .then(() => nodeIDList.reduce((pipeline, nodeID) => pipeline.then(() => this._run('INSERT OR IGNORE INTO cloud_broker_trial_block (node_id, create_date) VALUES (?,?)', [
                       nodeID,
                       now
                   ])), Promise.resolve()));
    }

    listPayout(where, orderBy, limit) {
        const {
                  sql,
                  parameters
              } = Database.buildQuery('SELECT * FROM cloud_broker_payout', where, orderBy, limit);
        return this._all(sql, parameters);
    }
}
