import {Database} from '../database';

/**
 * the passes this node bought (cloud_pass) and, on an exit node, the
 * certificates it carried with their pieces and latest receipt
 * (cloud_vpn_certificate)
 */
export default class CloudPass {
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

    _parsePass(row) {
        return row ? {
            ...row,
            certificate: row.certificate ? JSON.parse(row.certificate) : null,
            piece_list : JSON.parse(row.piece_list)
        } : row;
    }

    addPass(passID, brokerAddress, holderPublicKey, status) {
        return this._run('INSERT INTO cloud_pass (pass_id, broker_address, holder_public_key, status) VALUES (?,?,?,?)', [
            passID,
            brokerAddress,
            holderPublicKey,
            status
        ]);
    }

    updatePass(passID, fields) {
        const columnList = Object.keys(fields);
        return this._run(`UPDATE cloud_pass SET ${columnList.map(column => `${column} = ?`).join(', ')} WHERE pass_id = ?`,
            columnList.map(column => typeof fields[column] === 'object' && fields[column] !== null ? JSON.stringify(fields[column]) : fields[column]).concat([passID]));
    }

    getPass(passID) {
        return this._get('SELECT * FROM cloud_pass WHERE pass_id = ?', [passID]).then(row => this._parsePass(row));
    }

    getPassByCertificate(certificateID) {
        return this._get('SELECT * FROM cloud_pass WHERE certificate_id = ?', [certificateID]).then(row => this._parsePass(row));
    }

    listPass(where, orderBy, limit) {
        const {
                  sql,
                  parameters
              } = Database.buildQuery('SELECT * FROM cloud_pass', where, orderBy, limit);
        return this._all(sql, parameters).then(rows => rows.map(row => this._parsePass(row)));
    }

    _parseVPNCertificate(row) {
        return row ? {
            ...row,
            certificate     : JSON.parse(row.certificate),
            piece_index_list: JSON.parse(row.piece_index_list),
            receipt         : row.receipt ? JSON.parse(row.receipt) : null
        } : row;
    }

    addVPNCertificate(certificate) {
        return this._run('INSERT OR IGNORE INTO cloud_vpn_certificate (certificate_id, broker_address, certificate, end_date) VALUES (?,?,?,?)', [
            certificate.certificate_id,
            certificate.broker_address,
            JSON.stringify(certificate),
            certificate.end_date
        ]);
    }

    getVPNCertificate(certificateID) {
        return this._get('SELECT * FROM cloud_vpn_certificate WHERE certificate_id = ?', [certificateID]).then(row => this._parseVPNCertificate(row));
    }

    updateVPNCertificatePieceList(certificateID, pieceIndexList) {
        return this._run('UPDATE cloud_vpn_certificate SET piece_index_list = ? WHERE certificate_id = ?', [
            JSON.stringify(pieceIndexList),
            certificateID
        ]);
    }

    updateVPNCertificateReceipt(certificateID, receipt, receiptSignature) {
        return this._run('UPDATE cloud_vpn_certificate SET receipt = ?, receipt_signature = ?, receipt_total_bytes = ?, receipt_sequence = ? WHERE certificate_id = ? AND receipt_sequence < ?', [
            JSON.stringify(receipt),
            receiptSignature,
            receipt.total_bytes,
            receipt.sequence,
            certificateID,
            receipt.sequence
        ]);
    }

    listUnreportedVPNCertificate() {
        return this._all('SELECT * FROM cloud_vpn_certificate WHERE receipt_sequence > reported_sequence', [])
                   .then(rows => rows.map(row => this._parseVPNCertificate(row)));
    }

    updateVPNCertificateReported(certificateID, reportedSequence) {
        return this._run('UPDATE cloud_vpn_certificate SET reported_sequence = MAX(reported_sequence, ?) WHERE certificate_id = ?', [
            reportedSequence,
            certificateID
        ]);
    }
}
