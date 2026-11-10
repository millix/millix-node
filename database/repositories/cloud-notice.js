import {Database} from '../database';

/**
 * notices between nodes (cloud_notice) and the first and last time this
 * node saw a host offer from each node (cloud_host)
 */
export default class CloudNotice {
    constructor(database) {
        this.database = database;
    }

    _run(sql, parameters) {
        return new Promise((resolve, reject) => {
            this.database.run(sql, parameters, err => err ? reject(err.message || err) : resolve());
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

    _parse(row) {
        return row ? {
            ...row,
            notice: JSON.parse(row.notice)
        } : row;
    }

    /**
     * @return {Promise<boolean>} true if the notice was new
     */
    addNotice(notice, subject) {
        return this.getNotice(notice.notice_id)
                   .then(stored => stored ? false : this._insertNotice(notice, subject).then(() => true));
    }

    _insertNotice(notice, subject) {
        return this._run('INSERT OR IGNORE INTO cloud_notice (notice_id, notice_type, node_id, subject, notice, anchor_transaction_id, end_date) VALUES (?,?,?,?,?,?,?)', [
            notice.notice_id,
            notice.notice_type,
            notice.node_id,
            subject,
            JSON.stringify(notice),
            notice.anchor_transaction_id,
            notice.end_date
        ]);
    }

    getNotice(noticeID) {
        return this._all('SELECT * FROM cloud_notice WHERE notice_id = ?', [noticeID]).then(rows => this._parse(rows[0]));
    }

    setNoticeAnchored(noticeID, anchorDate) {
        return this._run('UPDATE cloud_notice SET status = 1, anchor_date = ? WHERE notice_id = ?', [
            anchorDate,
            noticeID
        ]);
    }

    listNotice(where, orderBy, limit) {
        const {
                  sql,
                  parameters
              } = Database.buildQuery('SELECT * FROM cloud_notice', where, orderBy, limit);
        return this._all(sql, parameters).then(rows => rows.map(row => this._parse(row)));
    }

    /**
     * the anchored notices about a subject that have not expired, with the
     * date this node first saw a host offer from each reporter
     */
    listNoticeWithHost(subject, now) {
        return this._all(`SELECT cloud_notice.notice_id, cloud_notice.node_id, cloud_notice.anchor_date, cloud_host.first_offer_date
                          FROM cloud_notice
                                   LEFT JOIN cloud_host ON cloud_notice.node_id = cloud_host.node_id
                          WHERE cloud_notice.subject = ?
                            AND cloud_notice.status = 1
                            AND cloud_notice.end_date > ?`, [
            subject,
            now
        ]);
    }

    removeNotice(noticeID) {
        return this._run('DELETE FROM cloud_notice WHERE notice_id = ?', [noticeID]);
    }

    removeExpiredNotice(now) {
        return this._run('DELETE FROM cloud_notice WHERE end_date <= ?', [now]);
    }

    recordHost(nodeID, now) {
        return this._run(`INSERT INTO cloud_host (node_id, first_offer_date, last_offer_date) VALUES (?1, ?2, ?2)
                          ON CONFLICT (node_id) DO UPDATE SET last_offer_date = MAX(last_offer_date, ?2)`, [
            nodeID,
            now
        ]);
    }
}
