import {Database} from '../database';

export default class Escrow {
    constructor(database) {
        this.database = database;
    }

    _parse(row) {
        if (!row) {
            return row;
        }
        return {
            ...row,
            terms  : JSON.parse(row.terms),
            receipt: row.receipt ? JSON.parse(row.receipt) : null
        };
    }

    addEscrow(escrowAddress, addressBase, role, nodeID, terms, fundingTransactionID) {
        return new Promise((resolve, reject) => {
            this.database.run('INSERT OR IGNORE INTO escrow (escrow_address, address_base, role, node_id, terms, funding_transaction_id, unlock_date) VALUES (?,?,?,?,?,?,?)',
                [
                    escrowAddress,
                    addressBase,
                    role,
                    nodeID,
                    JSON.stringify(terms),
                    fundingTransactionID || null,
                    terms.unlock_date
                ], (err) => {
                    if (err) {
                        return reject(err.message || err);
                    }
                    resolve();
                });
        });
    }

    getEscrow(addressBase) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT * FROM escrow WHERE address_base = ?', [addressBase], (err, row) => {
                if (err) {
                    return reject(err.message || err);
                }
                resolve(this._parse(row));
            });
        });
    }

    listEscrow(where, orderBy, limit) {
        return new Promise((resolve, reject) => {
            const {
                      sql,
                      parameters
                  } = Database.buildQuery('SELECT * FROM escrow', where, orderBy, limit);
            this.database.all(sql, parameters, (err, rows) => {
                if (err) {
                    return reject(err.message || err);
                }
                resolve(rows.map(row => this._parse(row)));
            });
        });
    }

    /**
     * keeps the receipt only if its sequence and total move forward. the
     * check and the write are one statement.
     * @return {Promise<boolean>} true if the receipt is the latest stored
     */
    updateReceipt(addressBase, receipt, receiptSignature) {
        return new Promise((resolve, reject) => {
            this.database.run('UPDATE escrow SET receipt = ?, receipt_signature = ?, receipt_total_bytes = ?, receipt_sequence = ? ' +
                              'WHERE address_base = ? AND receipt_sequence < ? AND receipt_total_bytes <= ?',
                [
                    JSON.stringify(receipt),
                    receiptSignature,
                    receipt.total_bytes,
                    receipt.sequence,
                    addressBase,
                    receipt.sequence,
                    receipt.total_bytes
                ], (err) => {
                    if (err) {
                        return reject(err.message || err);
                    }
                    this.getEscrow(addressBase)
                        .then(row => resolve(!!row && row.receipt_sequence === receipt.sequence))
                        .catch(reject);
                });
        });
    }

    updateFundingTransaction(addressBase, fundingTransactionID) {
        return new Promise((resolve, reject) => {
            this.database.run('UPDATE escrow SET funding_transaction_id = ? WHERE address_base = ?', [
                fundingTransactionID,
                addressBase
            ], (err) => {
                if (err) {
                    return reject(err.message || err);
                }
                resolve();
            });
        });
    }

    updateStatus(addressBase, status) {
        return new Promise((resolve, reject) => {
            this.database.run('UPDATE escrow SET status = ? WHERE address_base = ?', [
                status,
                addressBase
            ], (err) => {
                if (err) {
                    return reject(err.message || err);
                }
                resolve();
            });
        });
    }
}
