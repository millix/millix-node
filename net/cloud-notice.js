import _ from 'lodash';
import network from './network';
import eventBus from '../core/event-bus';
import config from '../core/config/config';
import database from '../database/database';
import wallet from '../core/wallet/wallet';
import walletUtils from '../core/wallet/wallet-utils';
import objectHash from '../core/crypto/object-hash';
import cloudPass from './broker/cloud-pass';
import ntp from '../core/ntp';
import task from '../core/task';
import console from '../core/console';

export const CLOUD_NOTICE_VERSION = 1;
export const NOTICE_TYPE_USER     = 'user';
export const NOTICE_TYPE_DOMAIN   = 'domain';

const NOTICE_STATUS_PENDING = 0;
const NOTICE_STATUS_VALID   = 1;

const NOTICE_COMMON_KEY_LIST = [
    'version',
    'notice_type',
    'node_id',
    'node_public_key',
    'create_date',
    'end_date',
    'notice_id',
    'anchor_transaction_id',
    'signature'
];
const USER_NOTICE_KEY_LIST   = [
    ...NOTICE_COMMON_KEY_LIST,
    'certificate',
    'pattern',
    'numbers',
    'receipt',
    'receipt_signature'
].sort();
const DOMAIN_NOTICE_KEY_LIST = [
    ...NOTICE_COMMON_KEY_LIST,
    'domain',
    'threat_type'
].sort();
const DOMAIN_PATTERN         = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
// a notice is pending until its anchor transaction is known and stable; a
// pending notice is dropped after this
const NOTICE_PENDING_TIME_MAX = 24 * 60 * 60;
const COUNT_CACHE_TIME        = 60 * 1000;


/**
 * notices between nodes about users and domains.
 *
 * - a user notice names a prepaid certificate, a pattern (for example
 *   unreceipted_gap), the numbers behind it, one receipt signed by the
 *   certificate's holder for the reporting node as proof that it carried
 *   the certificate, and an expiry. it never names the sites.
 * - a domain notice names a domain and a threat type.
 *
 * notices are signed by the reporting node's key and anchored by a millix
 * transaction: the reporting node's wallet sends itself a transaction whose
 * signed output metadata lists the notice ids, and the date of that
 * transaction is the notice's time. notices spread like offers: a node sends
 * the anchored notices it knows to every new peer and forwards every new
 * one.
 *
 * each node applies its own threshold (CLOUD_NOTICE_THRESHOLD): a
 * certificate or a domain counts as noticed once that many nodes reported
 * it. a notice counts only from a node this node saw offering a host service
 * at least CLOUD_NOTICE_HOST_AGE_MIN before the notice's time; a user notice
 * counts only with the receipt that shows the reporter carried the
 * certificate. an exit node refuses noticed certificates and tunnels to
 * noticed domains.
 */
class CloudNotice {
    constructor() {
        this._anchorQueue = [];
        this._countCache  = new Map();
        this._autoSet     = new Set();
    }

    _now() {
        return Math.floor(ntp.now().getTime() / 1000);
    }

    _isPositiveInteger(value) {
        return Number.isInteger(value) && value > 0;
    }

    getNoticeBody(notice) {
        return _.omit(notice, [
            'notice_id',
            'anchor_transaction_id',
            'signature'
        ]);
    }

    getSubject(notice) {
        return notice.notice_type === NOTICE_TYPE_USER ? `certificate:${notice.certificate.certificate_id}` : `domain:${notice.domain}`;
    }

    /**
     * checks the notice itself: its format, its signature by the node it
     * names, its expiry and, for a user notice, the certificate and the
     * receipt that shows the reporting node carried it. the anchor is checked
     * by checkAnchor.
     * @return {{valid: boolean, reason?: string}}
     */
    verifyNotice(notice, now = this._now()) {
        if (!_.isPlainObject(notice) || JSON.stringify(notice).length > config.CLOUD_NOTICE_SIZE_MAX) {
            return {
                valid : false,
                reason: 'notice_invalid_format'
            };
        }

        const keyList = notice.notice_type === NOTICE_TYPE_USER ? USER_NOTICE_KEY_LIST : notice.notice_type === NOTICE_TYPE_DOMAIN ? DOMAIN_NOTICE_KEY_LIST : null;
        if (notice.version !== CLOUD_NOTICE_VERSION || !keyList || !_.isEqual(_.keys(notice).sort(), keyList) ||
            typeof notice.anchor_transaction_id !== 'string' || notice.anchor_transaction_id.length === 0 || notice.anchor_transaction_id.length > 50) {
            return {
                valid : false,
                reason: 'notice_invalid_format'
            };
        }

        if (!this._isPositiveInteger(notice.create_date) || !this._isPositiveInteger(notice.end_date) ||
            notice.create_date > now + config.CLOUD_OFFER_CLOCK_SKEW_TOLERANCE || notice.end_date <= notice.create_date ||
            notice.end_date - notice.create_date > config.CLOUD_NOTICE_DURATION_MAX) {
            return {
                valid : false,
                reason: 'notice_invalid_date'
            };
        }
        if (notice.end_date <= now) {
            return {
                valid : false,
                reason: 'notice_expired'
            };
        }

        if (notice.notice_type === NOTICE_TYPE_USER) {
            // the numbers behind the pattern, never the sites
            if (!config.CLOUD_NOTICE_PATTERN_LIST.includes(notice.pattern) || !_.isPlainObject(notice.numbers) ||
                _.some(_.keys(notice.numbers), key => !config.CLOUD_NOTICE_NUMBER_KEY_LIST.includes(key)) ||
                _.some(_.values(notice.numbers), value => !Number.isInteger(value) || value < 0)) {
                return {
                    valid : false,
                    reason: 'notice_invalid_pattern'
                };
            }
            const certificate = notice.certificate;
            // the certificate may have ended since: its signature still
            // shows the broker issued it
            const {
                      valid,
                      reason
                  }           = cloudPass.verifyCertificate(certificate, _.isPlainObject(certificate) ? certificate.start_date : now);
            if (!valid) {
                return {
                    valid : false,
                    reason: `notice_${reason}`
                };
            }
            if (!cloudPass.isValidReceipt(certificate, notice.receipt, notice.receipt_signature, notice.node_id)) {
                return {
                    valid : false,
                    reason: 'notice_receipt_invalid'
                };
            }
        }
        else if (typeof notice.domain !== 'string' || !DOMAIN_PATTERN.test(notice.domain) || !config.CLOUD_NOTICE_THREAT_LIST.includes(notice.threat_type)) {
            return {
                valid : false,
                reason: 'notice_invalid_domain'
            };
        }

        let noticeID;
        try {
            noticeID = objectHash.getCHash288(this.getNoticeBody(notice));
        }
        catch (e) {
            noticeID = null;
        }
        if (noticeID !== notice.notice_id) {
            return {
                valid : false,
                reason: 'notice_invalid_id'
            };
        }

        if (typeof notice.signature !== 'string' || !walletUtils.isValidNodeIdentity(notice.node_id, notice.node_public_key, _.omit(notice, ['signature']), notice.signature)) {
            return {
                valid : false,
                reason: 'notice_invalid_signature'
            };
        }

        return {valid: true};
    }

    /**
     * the anchor transaction of a notice: it must list the notice id in its
     * signed output metadata and be stable
     * @return {Promise<number|null>} the anchor date, or null while the
     * anchor is not known or not stable
     */
    checkAnchor(notice) {
        return database.firstShards(shardID => new Promise((resolve, reject) => database.getRepository('transaction', shardID)
                                                                                       .getTransactionObject(notice.anchor_transaction_id)
                                                                                       .then(transaction => transaction ? resolve(transaction) : reject())
                                                                                       .catch(reject)))
                       .then(transaction => {
                           if (!transaction) {
                               wallet.requestTransactionFromNetwork(notice.anchor_transaction_id, {
                                   priority        : 1,
                                   dispatch_request: true
                               });
                               return null;
                           }
                           const version       = transaction.version;
                           const versionNumber = parseInt(version.substring(2, version.length - 1));
                           const noticeIDList  = transaction.transaction_output_attribute?.transaction_output_metadata?.cloud_notice;
                           if (version.charAt(1) !== 'a' || !(versionNumber >= 3) || !Array.isArray(noticeIDList) || !noticeIDList.includes(notice.notice_id)) {
                               return Promise.reject('notice_anchor_invalid');
                           }
                           // the transaction repository gives the date as a
                           // Date
                           const transactionDate = transaction.transaction_date;
                           const anchorDate      = transactionDate instanceof Date ? Math.floor(transactionDate.getTime() / 1000) : transactionDate;
                           if (!Number.isInteger(anchorDate) || anchorDate < notice.create_date - config.CLOUD_OFFER_CLOCK_SKEW_TOLERANCE) {
                               return Promise.reject('notice_anchor_invalid');
                           }
                           return transaction.is_stable ? anchorDate : null;
                       });
    }

    /**
     * a notice from a peer or this node: stored, and counted and forwarded
     * once its anchor is stable
     * @return {Promise<boolean>} true if the notice is new and anchored
     */
    addNotice(notice) {
        const {
                  valid,
                  reason
              } = this.verifyNotice(notice);
        if (!valid) {
            return Promise.reject(reason);
        }
        const cloudNoticeRepository = database.getRepository('cloud_notice');
        return cloudNoticeRepository.addNotice(notice, this.getSubject(notice))
                                    .then(isNew => isNew ? this._checkPendingNotice(notice) : false);
    }

    _checkPendingNotice(notice) {
        return this.checkAnchor(notice)
                   .then(anchorDate => {
                       if (anchorDate === null) {
                           return false;
                       }
                       this._countCache.delete(this.getSubject(notice));
                       return database.getRepository('cloud_notice')
                                      .setNoticeAnchored(notice.notice_id, anchorDate)
                                      .then(() => {
                                          console.log(`[cloud-notice] ${notice.notice_type} notice ${notice.notice_id} from node ${notice.node_id} anchored at ${anchorDate}`);
                                          return true;
                                      });
                   });
    }

    /**
     * checks the anchors of pending notices; forwards those that became
     * anchored and drops those whose anchor never came or is invalid
     */
    checkPendingNoticeList() {
        const cloudNoticeRepository = database.getRepository('cloud_notice');
        const now                   = this._now();
        return cloudNoticeRepository.listNotice({status: NOTICE_STATUS_PENDING}, 'create_date asc', 1000)
                                    .then(rowList => rowList.reduce((pipeline, row) => pipeline.then(newList => this._checkPendingNotice(row.notice)
                                                                                                                  .then(isAnchored => {
                                                                                                                      if (isAnchored) {
                                                                                                                          return [...newList, row.notice];
                                                                                                                      }
                                                                                                                      return now - row.create_date > NOTICE_PENDING_TIME_MAX ? cloudNoticeRepository.removeNotice(row.notice_id).then(() => newList) : newList;
                                                                                                                  })
                                                                                                                  .catch(reason => {
                                                                                                                      console.log(`[cloud-notice] notice ${row.notice_id} dropped: ${reason}`);
                                                                                                                      return cloudNoticeRepository.removeNotice(row.notice_id).then(() => newList);
                                                                                                                  })), Promise.resolve([])))
                                    .then(newList => {
                                        this.propagateNoticeList(newList);
                                        return cloudNoticeRepository.removeExpiredNotice(now).then(() => newList);
                                    });
    }

    /**
     * how many nodes reported a subject, counting only nodes this node saw
     * offering a host service at least CLOUD_NOTICE_HOST_AGE_MIN before
     * their notice's time
     */
    countReporters(subject) {
        const cached = this._countCache.get(subject);
        if (cached && Date.now() - cached.time < COUNT_CACHE_TIME) {
            return Promise.resolve(cached.count);
        }
        return database.getRepository('cloud_notice')
                       .listNoticeWithHost(subject, this._now())
                       .then(rowList => {
                           const count = _.uniq(_.map(_.filter(rowList, row => row.first_offer_date !== null &&
                                                                              row.anchor_date - row.first_offer_date >= config.CLOUD_NOTICE_HOST_AGE_MIN), 'node_id')).length;
                           this._countCache.set(subject, {
                               count,
                               time: Date.now()
                           });
                           return count;
                       });
    }

    isCertificateNoticed(certificateID) {
        return this.countReporters(`certificate:${certificateID}`).then(count => count >= config.CLOUD_NOTICE_THRESHOLD);
    }

    /**
     * true if the domain or a domain above it was reported by enough nodes
     */
    isDomainNoticed(host) {
        const labelList = String(host).toLowerCase().replace(/\.$/, '').split('.');
        if (labelList.length < 2) {
            return Promise.resolve(false);
        }
        const domainList = _.range(0, labelList.length - 1).map(index => labelList.slice(index).join('.'));
        return Promise.all(domainList.map(domain => this.countReporters(`domain:${domain}`)))
                      .then(countList => _.some(countList, count => count >= config.CLOUD_NOTICE_THRESHOLD));
    }

    /**
     * this node records when it sees host offers, to judge how long a node
     * has been a host
     */
    recordHost(offer) {
        if (!['vpn_exit', 'storage_host'].includes(offer.service)) {
            return Promise.resolve();
        }
        return Promise.resolve().then(() => database.getRepository('cloud_notice').recordHost(offer.node_id, this._now()));
    }

    _createNotice(fields, duration) {
        const now  = this._now();
        const body = {
            version        : CLOUD_NOTICE_VERSION,
            node_id        : network.nodeID,
            node_public_key: network.nodePublicKey,
            create_date    : now,
            end_date       : now + Math.min(duration, config.CLOUD_NOTICE_DURATION_MAX),
            ...fields
        };
        return {
            ...body,
            notice_id: objectHash.getCHash288(body)
        };
    }

    /**
     * a user notice about a certificate this node carried
     * @param certificate
     * @param pattern
     * @param numbers {bytes_sent, bytes_receipted, refused_count,
     * tunnel_count, duration}
     * @param receipt a receipt of the certificate's holder for this node
     * @param receiptSignature
     * @param duration seconds until the notice expires
     */
    publishUserNotice(certificate, pattern, numbers, receipt, receiptSignature, duration = config.CLOUD_NOTICE_DURATION_MAX) {
        return this._publish(this._createNotice({
            notice_type      : NOTICE_TYPE_USER,
            certificate,
            pattern,
            numbers,
            receipt,
            receipt_signature: receiptSignature
        }, duration));
    }

    publishDomainNotice(domain, threatType, duration = config.CLOUD_NOTICE_DURATION_MAX) {
        return this._publish(this._createNotice({
            notice_type: NOTICE_TYPE_DOMAIN,
            domain     : String(domain).toLowerCase(),
            threat_type: threatType
        }, duration));
    }

    /**
     * checks the notice, anchors it with a transaction of this wallet and
     * stores it; it spreads once the anchor is stable
     */
    _publish(noticeBody) {
        // check everything but the anchor and the signature first
        const {
                  valid,
                  reason
              } = this.verifyNotice({
            ...noticeBody,
            anchor_transaction_id: '-',
            signature            : walletUtils.signMessage(network.nodePrivateKey, {
                ...noticeBody,
                anchor_transaction_id: '-'
            })
        });
        if (!valid) {
            return Promise.reject(reason);
        }
        return this._anchor([noticeBody]).then(([notice]) => notice);
    }

    /**
     * one transaction of this wallet to itself anchors the notices: its
     * signed output metadata lists their ids
     */
    _anchor(noticeBodyList) {
        const addressVersion = database.getRepository('address').getDefaultAddressVersion().version;
        return wallet.addTransaction([
            {
                address_base          : wallet.defaultKeyIdentifier,
                address_version       : addressVersion,
                address_key_identifier: wallet.defaultKeyIdentifier,
                amount                : config.CLOUD_NOTICE_ANCHOR_AMOUNT
            }
        ], {
            fee_type: 'transaction_fee_default',
            amount  : config.TRANSACTION_FEE_PROXY
        }, undefined, config.MODE_TEST_NETWORK ? 'la3l' : '0a30', {
            cloud_notice: _.map(noticeBodyList, 'notice_id')
        }).then(transactionList => {
            const transaction = _.last(transactionList);
            const noticeList  = noticeBodyList.map(noticeBody => {
                const anchored = {
                    ...noticeBody,
                    anchor_transaction_id: transaction.transaction_id
                };
                return {
                    ...anchored,
                    signature: walletUtils.signMessage(network.nodePrivateKey, anchored)
                };
            });
            console.log(`[cloud-notice] anchored ${noticeList.length} notices in transaction ${transaction.transaction_id}`);
            return Promise.all(noticeList.map(notice => database.getRepository('cloud_notice').addNotice(notice, this.getSubject(notice))))
                          .then(() => noticeList);
        });
    }

    /**
     * an exit node reports a pattern it saw for a certificate, once per
     * certificate and pattern, when it holds a receipt as proof
     */
    autoNotice(certificate, pattern, numbers, receipt, receiptSignature) {
        const key = `${certificate.certificate_id}:${pattern}`;
        if (!config.CLOUD_NOTICE_AUTO || !receipt || this._autoSet.has(key)) {
            return Promise.resolve(null);
        }
        this._autoSet.add(key);
        return this.publishUserNotice(certificate, pattern, numbers, receipt, receiptSignature)
                   .then(notice => {
                       console.log(`[cloud-notice] reported ${pattern} for certificate ${certificate.certificate_id}`);
                       return notice;
                   })
                   .catch(error => {
                       console.log(`[cloud-notice] ${pattern} for certificate ${certificate.certificate_id} not reported: ${error?.error || error}`);
                       return null;
                   });
    }

    listNotice(where, orderBy = 'create_date desc', limit = 1000) {
        return database.getRepository('cloud_notice').listNotice(where, orderBy, limit);
    }

    sendNoticeList(noticeList, ws) {
        _.each(_.chunk(noticeList, config.CLOUD_NOTICE_LIST_SIZE_MAX), noticeListChunk => {
            const payload = {
                type   : 'cloud_notice_list',
                content: {notice_list: noticeListChunk}
            };
            eventBus.emit('node_event_log', payload);
            try {
                ws.nodeConnectionReady && ws.send(JSON.stringify(payload));
            }
            catch (e) {
                console.log('[WARN]: try to send data over a closed connection.');
                ws && ws.close();
            }
        });
    }

    propagateNoticeList(noticeList, excludeWS) {
        if (noticeList.length === 0) {
            return;
        }
        network.registeredClients.forEach(ws => ws !== excludeWS && this.sendNoticeList(noticeList, ws));
    }

    _onNoticeList(content, ws) {
        eventBus.emit('node_event_log', {
            type: 'cloud_notice_list',
            from: ws.node,
            content
        });
        if (!content || !Array.isArray(content.notice_list)) {
            return;
        }
        const newList = [];
        Promise.all(content.notice_list.slice(0, config.CLOUD_NOTICE_LIST_SIZE_MAX).map(notice => this.addNotice(notice)
                                                                                                    .then(isAnchored => isAnchored && newList.push(notice))
                                                                                                    .catch(reason => console.log(`[cloud-notice] notice ${notice?.notice_id} from node ${ws.nodeID} rejected: ${reason}`))))
               .then(() => this.propagateNoticeList(newList, ws));
    }

    _onNewPeerConnection(ws) {
        if (!ws.nodeConnectionReady) {
            return;
        }
        this.listNotice({status: NOTICE_STATUS_VALID})
            .then(rowList => this.sendNoticeList(_.map(rowList, 'notice'), ws))
            .catch(_ => _);
    }

    initialize() {
        this._newPeerConnectionListener = this._onNewPeerConnection.bind(this);
        eventBus.on('cloud_notice_list', this._onNoticeList.bind(this));
        eventBus.on('peer_connection_new', this._newPeerConnectionListener);
        task.scheduleTask('cloud_notice_pending', this.checkPendingNoticeList.bind(this), config.CLOUD_NOTICE_TASK_WAIT_TIME, true);
        return Promise.resolve();
    }

    stop() {
        eventBus.removeAllListeners('cloud_notice_list');
        if (this._newPeerConnectionListener) {
            eventBus.removeListener('peer_connection_new', this._newPeerConnectionListener);
            this._newPeerConnectionListener = null;
        }
        task.removeTask('cloud_notice_pending');
    }
}


export default new CloudNotice();
