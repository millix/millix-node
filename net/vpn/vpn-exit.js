import _ from 'lodash';
import http2 from 'http2';
import net from 'net';
import crypto from 'crypto';
import network from '../network';
import config from '../../core/config/config';
import escrow from '../../core/wallet/escrow';
import walletEscrow from '../../core/wallet/wallet-escrow';
import wallet from '../../core/wallet/wallet';
import database from '../../database/database';
import objectHash from '../../core/crypto/object-hash';
import signature from '../../core/crypto/signature';
import {resolvePublicAddress} from './address-filter';
import ntp from '../../core/ntp';
import eventBus from '../../core/event-bus';
import cloudOffer from '../cloud-offer';
import cloudPass from '../broker/cloud-pass';
import {requestNodeService} from '../broker/node-request';
import task from '../../core/task';
import {ForwardHost} from './forward';
import cloudNotice from '../cloud-notice';
import console from '../../core/console';

const {
          HTTP2_HEADER_METHOD,
          HTTP2_HEADER_PATH,
          HTTP2_HEADER_AUTHORITY,
          HTTP2_HEADER_STATUS,
          HTTP2_HEADER_CONTENT_TYPE,
          HTTP2_METHOD_CONNECT,
          NGHTTP2_REFUSED_STREAM,
          NGHTTP2_CANCEL
      } = http2.constants;

const BODY_SIZE_MAX = 16 * 1024;
// the first byte of a tls record carrying a handshake
const TLS_HANDSHAKE_RECORD = 0x16;


/**
 * the exit node side of the tangled cloud vpn.
 *
 * pass holders connect over tls with the node certificate (their node checks
 * that the certificate's node id is the one in the offer). one http/2
 * connection carries the whole session:
 *
 * - GET /vpn/challenge returns a random challenge.
 * - POST /vpn/session {pass: {terms, funding_transaction_id},
 *   challenge_signature} proves the client holds the pass key of an escrow
 *   that pays this node. or, with a broker pass, POST /vpn/session {pass:
 *   {certificate, piece}, challenge_signature}: a prepaid certificate of a
 *   broker this node's offer accepts, one of its pieces, and the challenge
 *   signed by the holder key.
 * - POST /vpn/piece {piece} adds the next piece of the certificate: each
 *   piece this node has seen covers piece_bytes.
 * - CONNECT host:443 opens a tunnel to a site. only port 443 is accepted, the
 *   first bytes from the client must start a tls handshake, and sites whose
 *   name points to a private or local address are refused. the exit node
 *   sees the site name and the byte count, never the content.
 * - POST /vpn/receipt {receipt, signature} carries a receipt signed by the
 *   pass key with the running total of bytes received and a sequence.
 *
 * the session closes when the bytes sent run ahead of the receipts by more
 * than VPN_RECEIPT_GAP_BYTES_MAX, when the escrow's data (or the pieces seen)
 * is used up or after VPN_SESSION_IDLE_TIME_MAX without traffic.
 *
 * the latest receipt of each certificate is sent to its broker every
 * CLOUD_BROKER_REPORT_INTERVAL, in a report signed by the node key naming
 * this wallet's address for the payout.
 *
 * a trial certificate is refused when its broker says its trial does not
 * extend to this node (the broker would not pay its trial receipts). the
 * broker's answer is kept for CLOUD_BROKER_REPORT_INTERVAL; when the broker
 * cannot be asked the trial is accepted.
 */
class VPNExit {
    constructor() {
        this.server         = null;
        this.sessionMap     = new Map();
        this.forwardHost    = null;
        // broker address: {trial_extended, check_date}
        this.trialStatusMap = new Map();
    }

    _now() {
        return Math.floor(ntp.now().getTime() / 1000);
    }

    _respond(stream, status, body) {
        if (stream.destroyed || stream.closed) {
            return;
        }
        try {
            stream.respond({
                [HTTP2_HEADER_STATUS]      : status,
                [HTTP2_HEADER_CONTENT_TYPE]: 'application/json'
            });
            stream.end(JSON.stringify(body));
        }
        catch (e) {
            stream.destroy();
        }
    }

    _readBody(stream) {
        return new Promise((resolve, reject) => {
            let body = '';
            stream.setEncoding('utf8');
            stream.on('data', chunk => {
                body += chunk;
                if (body.length > BODY_SIZE_MAX) {
                    reject('body_too_large');
                    stream.close(NGHTTP2_CANCEL);
                }
            });
            stream.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                }
                catch (e) {
                    reject('body_invalid');
                }
            });
            stream.on('error', reject);
        });
    }

    _closeSession(state, reason) {
        if (state.closed) {
            return;
        }
        state.closed       = true;
        state.close_reason = reason;
        console.log(`[vpn-exit] session ${state.session_id} closed: ${reason}. sent ${state.bytes_sent} bytes, receipted ${state.receipt_total_bytes}`);
        if (reason === 'unreceipted_gap' && state.pass_type === 'certificate') {
            // a notice for other exit nodes, with a receipt as proof that
            // this node carried the certificate
            cloudNotice.autoNotice(state.certificate, 'unreceipted_gap', {
                bytes_sent     : state.bytes_sent,
                bytes_receipted: state.receipt_total_bytes
            }, state.receipt, state.receipt_signature);
        }
        this.sessionMap.delete(state.session_id);
        try {
            state.session.close();
            setTimeout(() => !state.session.destroyed && state.session.destroy(), 1000);
        }
        catch (e) {
        }
    }

    _onSession(session) {
        if (this.sessionMap.size >= config.VPN_SESSION_MAX) {
            session.destroy();
            return;
        }

        const state = {
            session_id         : crypto.randomBytes(8).toString('hex'),
            session,
            remote_address     : session.socket.remoteAddress,
            challenge          : null,
            authenticated      : false,
            escrow_record      : null,
            bytes_sent         : 0,
            bytes_received     : 0,
            bytes_covered      : 0,
            receipt_total_bytes: 0,
            receipt_sequence   : 0,
            site_list          : new Set(),
            connect_date       : this._now(),
            closed             : false
        };
        session.vpnState = state;
        this.sessionMap.set(state.session_id, state);
        session.setTimeout(config.VPN_SESSION_IDLE_TIME_MAX, () => this._closeSession(state, 'idle'));
        session.on('close', () => this._closeSession(state, 'connection_closed'));
        session.on('error', () => this._closeSession(state, 'connection_error'));
        setTimeout(() => !state.authenticated && this._closeSession(state, 'auth_timeout'), config.VPN_AUTH_WAIT_TIME_MAX);
    }

    _onStream(stream, headers) {
        const state = stream.session.vpnState;
        if (!state || state.closed) {
            return stream.close(NGHTTP2_REFUSED_STREAM);
        }
        stream.on('error', _ => _);

        const method = headers[HTTP2_HEADER_METHOD];
        const path   = headers[HTTP2_HEADER_PATH];
        if (method === HTTP2_METHOD_CONNECT) {
            return this._onConnect(state, stream, headers[HTTP2_HEADER_AUTHORITY]);
        }
        else if (method === 'GET' && path === '/vpn/challenge') {
            state.challenge = crypto.randomBytes(32).toString('hex');
            return this._respond(stream, 200, {
                challenge: state.challenge,
                node_id  : network.nodeID
            });
        }
        else if (method === 'POST' && path === '/vpn/session') {
            return this._readBody(stream)
                       .then(body => this._authenticate(state, body))
                       .then(result => this._respond(stream, 200, result))
                       .catch(error => this._respond(stream, 403, {error: error?.message || error}));
        }
        else if (method === 'POST' && path === '/vpn/receipt') {
            return this._readBody(stream)
                       .then(body => state.pass_type === 'certificate' ? this._onCertificateReceipt(state, body) : this._onReceipt(state, body))
                       .then(result => this._respond(stream, 200, result))
                       .catch(error => this._respond(stream, 403, {error: error?.message || error}));
        }
        else if (method === 'POST' && path === '/vpn/piece') {
            return this._readBody(stream)
                       .then(body => this._onPiece(state, body))
                       .then(result => this._respond(stream, 200, result))
                       .catch(error => this._respond(stream, 403, {error: error?.message || error}));
        }

        // plain http requests are never carried: they would show their
        // pages to the exit node
        this._respond(stream, 403, {error: 'https_only'});
    }

    _authenticate(state, body) {
        if (state.authenticated) {
            return Promise.reject('session_already_authenticated');
        }
        if (!state.challenge) {
            return Promise.reject('challenge_not_found');
        }
        if (body?.pass?.certificate) {
            return this._authenticateCertificate(state, body);
        }

        const terms = body?.pass?.terms;
        if (!escrow.isValidTerms(terms)) {
            return Promise.reject('pass_invalid');
        }

        const now = this._now();
        if (!escrow.isActive(now)) {
            return Promise.reject('escrow_not_active');
        }
        if (terms.payee_public_key !== network.nodePublicKey) {
            return Promise.reject('pass_not_for_this_node');
        }
        if (terms.portion_bytes !== config.VPN_ESCROW_PORTION_BYTES || terms.portion_amount < config.VPN_ESCROW_PORTION_AMOUNT ||
            terms.portion_amount <= config.TRANSACTION_FEE_PROXY) {
            return Promise.reject('pass_price_not_accepted');
        }
        if (terms.unlock_date - now < config.VPN_ESCROW_UNLOCK_REMAINING_MIN || terms.unlock_date - now > config.ESCROW_UNLOCK_DURATION_MAX) {
            return Promise.reject('pass_unlock_date_not_accepted');
        }

        const message = {
            challenge: state.challenge,
            node_id  : network.nodeID
        };
        let isValidSignature;
        try {
            isValidSignature = signature.verify(objectHash.getHashBuffer(message), body.challenge_signature, terms.payer_public_key);
        }
        catch (e) {
            isValidSignature = false;
        }
        if (!isValidSignature) {
            return Promise.reject('challenge_signature_invalid');
        }

        const escrowAddress = escrow.getEscrowAddress(terms);
        if (_.some([...this.sessionMap.values()], other => other !== state && other.authenticated && other.escrow_record.address_base === escrowAddress.address_base)) {
            return Promise.reject('pass_already_connected');
        }

        const fundingTransactionID = typeof body.pass.funding_transaction_id === 'string' ? body.pass.funding_transaction_id : undefined;
        return Promise.all([
            database.getRepository('escrow').getEscrow(escrowAddress.address_base),
            walletEscrow.getEscrowInputList(terms)
        ]).then(([knownEscrowRecord, inputList]) => {
            const receiptTotalBytes = knownEscrowRecord ? knownEscrowRecord.receipt_total_bytes : 0;
            const amountLocked      = _.sum(_.map(inputList, input => input.amount));
            // what has not been earned yet must still be locked in the
            // escrow. the escrow is only recorded once it is funded.
            if (inputList.length === 0 || amountLocked < terms.amount - escrow.getEarnedAmount(terms, receiptTotalBytes)) {
                walletEscrow.requestFundingTransaction(fundingTransactionID);
                return Promise.reject('escrow_not_funded');
            }
            if (receiptTotalBytes >= escrow.getBytesCovered(terms)) {
                return Promise.reject('pass_data_used');
            }
            return walletEscrow.addPayeeEscrow(terms, fundingTransactionID);
        }).then(escrowRecord => {
            state.authenticated       = true;
            state.pass_type           = 'escrow';
            state.challenge           = null;
            state.escrow_record       = escrowRecord;
            state.pass_public_key     = terms.payer_public_key;
            state.bytes_covered       = escrow.getBytesCovered(terms);
            // a session continues from the escrow's latest
            // receipt
            state.bytes_sent          = escrowRecord.receipt_total_bytes;
            state.receipt_total_bytes = escrowRecord.receipt_total_bytes;
            state.receipt_sequence    = escrowRecord.receipt_sequence;
            console.log(`[vpn-exit] session ${state.session_id} accepted pass for escrow ${escrowAddress.address}`);
            return {
                session_id         : state.session_id,
                escrow_address     : escrowAddress.address,
                bytes_covered      : state.bytes_covered,
                receipt_total_bytes: state.receipt_total_bytes,
                receipt_sequence   : state.receipt_sequence,
                receipt_gap_max    : config.VPN_RECEIPT_GAP_BYTES_MAX
            };
        });
    }

    /**
     * a broker pass: a prepaid certificate of a broker this node's vpn_exit
     * offer accepts, one of its pieces and the challenge signed by the
     * holder key
     */
    _authenticateCertificate(state, body) {
        const {
                  certificate,
                  piece
              }   = body.pass;
        const now = this._now();
        const {
                  valid,
                  reason
              }   = cloudPass.verifyCertificate(certificate, now);
        if (!valid) {
            return Promise.reject(reason);
        }
        if (!cloudPass.isValidPiece(certificate, piece)) {
            return Promise.reject('piece_invalid');
        }
        if (!cloudPass.isValidHolderMessage({
            challenge: state.challenge,
            node_id  : network.nodeID
        }, body.challenge_signature, certificate.holder_public_key)) {
            return Promise.reject('challenge_signature_invalid');
        }
        if (_.some([...this.sessionMap.values()], other => other !== state && other.authenticated && other.certificate?.certificate_id === certificate.certificate_id)) {
            return Promise.reject('pass_already_connected');
        }

        const cloudPassRepository = database.getRepository('cloud_pass');
        return database.getRepository('cloud_offer')
                       .getOffer(network.nodeID, 'vpn_exit')
                       .then(offer => {
                           // this node accepts the brokers its offer lists
                           if (!offer || offer.end_date <= now || !_.some(offer.broker_list, {
                               address   : certificate.broker_address,
                               public_key: certificate.broker_public_key
                           })) {
                               return Promise.reject('broker_not_accepted');
                           }
                           // nor certificates enough hosts reported
                           return cloudNotice.isCertificateNoticed(certificate.certificate_id);
                       })
                       .then(isNoticed => {
                           if (isNoticed) {
                               return Promise.reject('pass_noticed');
                           }
                           // a trial certificate only where its broker
                           // extends the trial
                           return cloudPass.isTrialCertificate(certificate) ? this._isTrialExtended(certificate.broker_address) : true;
                       })
                       .then(isExtended => isExtended ? cloudPassRepository.addVPNCertificate(certificate) : Promise.reject('trial_not_extended'))
                       .then(() => cloudPassRepository.getVPNCertificate(certificate.certificate_id))
                       .then(record => {
                           const pieceIndexList = _.sortBy(_.uniq([...record.piece_index_list, piece.piece_index]));
                           return cloudPassRepository.updateVPNCertificatePieceList(certificate.certificate_id, pieceIndexList)
                                                     .then(() => [
                                                         record,
                                                         pieceIndexList
                                                     ]);
                       })
                       .then(([record, pieceIndexList]) => {
                           const bytesCovered = pieceIndexList.length * certificate.piece_bytes;
                           if (record.receipt_total_bytes >= bytesCovered) {
                               return Promise.reject('pass_data_used');
                           }
                           state.authenticated       = true;
                           state.pass_type           = 'certificate';
                           state.challenge           = null;
                           state.certificate         = certificate;
                           state.piece_index_list    = pieceIndexList;
                           state.pass_public_key     = certificate.holder_public_key;
                           state.bytes_covered       = bytesCovered;
                           // a session continues from the certificate's
                           // latest receipt at this node
                           state.bytes_sent          = record.receipt_total_bytes;
                           state.receipt_total_bytes = record.receipt_total_bytes;
                           state.receipt_sequence    = record.receipt_sequence;
                           console.log(`[vpn-exit] session ${state.session_id} accepted certificate ${certificate.certificate_id} of broker ${certificate.broker_address}`);
                           return {
                               session_id         : state.session_id,
                               certificate_id     : certificate.certificate_id,
                               bytes_covered      : state.bytes_covered,
                               receipt_total_bytes: state.receipt_total_bytes,
                               receipt_sequence   : state.receipt_sequence,
                               receipt_gap_max    : config.VPN_RECEIPT_GAP_BYTES_MAX
                           };
                       });
    }

    _onPiece(state, body) {
        if (!state.authenticated || state.pass_type !== 'certificate') {
            return Promise.reject('session_not_authenticated');
        }
        const piece = body?.piece;
        if (!cloudPass.isValidPiece(state.certificate, piece)) {
            return Promise.reject('piece_invalid');
        }
        state.piece_index_list = _.sortBy(_.uniq([...state.piece_index_list, piece.piece_index]));
        state.bytes_covered    = state.piece_index_list.length * state.certificate.piece_bytes;
        return database.getRepository('cloud_pass')
                       .updateVPNCertificatePieceList(state.certificate.certificate_id, state.piece_index_list)
                       .then(() => ({bytes_covered: state.bytes_covered}));
    }

    _onCertificateReceipt(state, body) {
        if (!state.authenticated) {
            return Promise.reject('session_not_authenticated');
        }
        const receipt = body?.receipt;
        if (!_.isPlainObject(receipt) || !Number.isInteger(receipt.total_bytes) || receipt.total_bytes > state.bytes_sent) {
            // a receipt cannot cover more than this node sent
            return Promise.reject('receipt_total_invalid');
        }
        if (receipt.sequence <= state.receipt_sequence || receipt.total_bytes < state.receipt_total_bytes ||
            !cloudPass.isValidReceipt(state.certificate, receipt, body.signature, network.nodeID)) {
            return Promise.reject('receipt_not_accepted');
        }

        state.receipt_total_bytes = receipt.total_bytes;
        state.receipt_sequence    = receipt.sequence;
        state.receipt             = receipt;
        state.receipt_signature   = body.signature;
        return database.getRepository('cloud_pass')
                       .updateVPNCertificateReceipt(state.certificate.certificate_id, receipt, body.signature)
                       .then(() => ({
                           receipt_total_bytes: state.receipt_total_bytes,
                           receipt_sequence   : state.receipt_sequence
                       }));
    }

    /**
     * the newest valid broker offer of a broker
     */
    _findBrokerOffer(brokerAddress) {
        return cloudOffer.listOffers({service: 'broker'}, 'create_date desc', 1000)
                         .then(offerList => _.find(offerList, offer => offer.broker?.address === brokerAddress && cloudOffer.verifyOffer(offer).valid))
                         .then(offer => offer || Promise.reject('broker_offer_not_found'));
    }

    /**
     * whether a broker's trial extends to this node, as the broker answers a
     * request signed by the node key
     */
    _isTrialExtended(brokerAddress) {
        const now    = this._now();
        const status = this.trialStatusMap.get(brokerAddress);
        if (status && now - status.check_date < config.CLOUD_BROKER_REPORT_INTERVAL) {
            return Promise.resolve(status.trial_extended);
        }
        return this._findBrokerOffer(brokerAddress)
                   .then(offer => requestNodeService(offer.endpoint, offer.node_id, 'POST', '/broker/trial/status',
                       cloudPass.signNodeRequest(network.nodeID, network.nodePublicKey, now, network.nodePrivateKey)))
                   .then(({trial_extended: isExtended}) => {
                       isExtended = isExtended !== false;
                       this.trialStatusMap.set(brokerAddress, {
                           trial_extended: isExtended,
                           check_date    : now
                       });
                       return isExtended;
                   })
                   .catch(error => {
                       console.log(`[vpn-exit] trial status not known from broker ${brokerAddress}: ${error?.error || error}`);
                       return true;
                   });
    }

    _getPayoutAddress() {
        const addressVersion = database.getRepository('address').getDefaultAddressVersion().version;
        return `${wallet.defaultKeyIdentifier}${addressVersion}${wallet.defaultKeyIdentifier}`;
    }

    /**
     * sends the latest receipt of every certificate not yet reported to its
     * broker
     */
    reportReceipts() {
        const cloudPassRepository = database.getRepository('cloud_pass');
        return cloudPassRepository.listUnreportedVPNCertificate()
                                  .then(recordList => Promise.all(_.map(_.groupBy(recordList, 'broker_address'), (brokerRecordList, brokerAddress) =>
                                      this._findBrokerOffer(brokerAddress)
                                          .then(offer => _.chunk(brokerRecordList, config.CLOUD_BROKER_REPORT_RECEIPT_MAX).reduce((pipeline, chunk) => pipeline.then(() => {
                                              const report = cloudPass.signHostReport({
                                                  node_id        : network.nodeID,
                                                  node_public_key: network.nodePublicKey,
                                                  payout_address : this._getPayoutAddress(),
                                                  report_date    : this._now(),
                                                  receipt_list   : chunk.map(record => ({
                                                      certificate_id: record.certificate_id,
                                                      receipt       : record.receipt,
                                                      signature     : record.receipt_signature
                                                  }))
                                              }, network.nodePrivateKey);
                                              return requestNodeService(offer.endpoint, offer.node_id, 'POST', '/broker/report', {report})
                                                  .then(({receipt_list: resultList}) => Promise.all(_.filter(resultList, result => ['accepted', 'receipt_not_newer'].includes(result.status))
                                                                                                   .map(result => cloudPassRepository.updateVPNCertificateReported(result.certificate_id, result.sequence))));
                                          }), Promise.resolve()))
                                          .then(() => console.log(`[vpn-exit] reported ${brokerRecordList.length} receipts to broker ${brokerAddress}`))
                                          .catch(error => console.log(`[vpn-exit] receipts not reported to broker ${brokerAddress}: ${error}`)))));
    }

    _onReceipt(state, body) {
        if (!state.authenticated) {
            return Promise.reject('session_not_authenticated');
        }
        const receipt = body?.receipt;
        if (!_.isPlainObject(receipt) || !Number.isInteger(receipt.total_bytes) || receipt.total_bytes > state.bytes_sent) {
            // a receipt cannot cover more than this node sent
            return Promise.reject('receipt_total_invalid');
        }

        if (receipt.sequence <= state.receipt_sequence || receipt.total_bytes < state.receipt_total_bytes ||
            !escrow.isValidReceipt(state.escrow_record.terms, receipt, body.signature, state.escrow_record.address_base)) {
            return Promise.reject('receipt_not_accepted');
        }

        // the signed receipt counts for the gap at once, while it is stored
        state.receipt_total_bytes = receipt.total_bytes;
        state.receipt_sequence    = receipt.sequence;
        state.receipt             = receipt;
        return walletEscrow.addReceipt(state.escrow_record, receipt, body.signature)
                           .then(() => ({
                               receipt_total_bytes: state.receipt_total_bytes,
                               receipt_sequence   : state.receipt_sequence
                           }));
    }

    _countBytesSent(state, byteCount) {
        state.bytes_sent += byteCount;
        if (state.bytes_sent - state.receipt_total_bytes > config.VPN_RECEIPT_GAP_BYTES_MAX) {
            this._closeSession(state, 'unreceipted_gap');
        }
        else if (state.bytes_sent >= state.bytes_covered) {
            this._closeSession(state, 'data_used');
        }
    }

    _onConnect(state, stream, authority) {
        if (!state.authenticated) {
            return this._respond(stream, 401, {error: 'session_not_authenticated'});
        }

        const match = /^(?<host>\[[0-9a-f:.]+]|[^:]+):(?<port>\d+)$/i.exec(authority || '');
        if (!match) {
            return this._respond(stream, 400, {error: 'authority_invalid'});
        }
        const host = match.groups.host;
        const port = parseInt(match.groups.port);
        if (!config.VPN_ALLOWED_PORT_LIST.includes(port)) {
            console.log(`[vpn-exit] session ${state.session_id} refused ${host}:${port}: https_only`);
            return this._respond(stream, 403, {error: 'https_only'});
        }

        cloudNotice.isDomainNoticed(host)
            .catch(() => false)
            .then(isNoticed => isNoticed ? Promise.reject('domain_noticed') : resolvePublicAddress(host))
            .then(({address}) => {
                if (state.closed || stream.destroyed) {
                    return;
                }
                const socket = net.connect({
                    host: address,
                    port
                });
                let isFirstChunk = true;
                socket.setTimeout(config.VPN_SESSION_IDLE_TIME_MAX, () => socket.destroy());
                socket.on('connect', () => {
                    state.site_list.add(host);
                    console.log(`[vpn-exit] session ${state.session_id} tunnel to ${host}:${port}`);
                    stream.respond({[HTTP2_HEADER_STATUS]: 200});
                    stream.on('data', chunk => {
                        if (isFirstChunk) {
                            isFirstChunk = false;
                            if (chunk[0] !== TLS_HANDSHAKE_RECORD) {
                                // not a tls connection: plain http on port 443
                                console.log(`[vpn-exit] session ${state.session_id} closed tunnel to ${host}: https_only`);
                                socket.destroy();
                                stream.close(NGHTTP2_REFUSED_STREAM);
                                return;
                            }
                        }
                        state.bytes_received += chunk.length;
                        socket.write(chunk);
                    });
                    stream.on('end', () => socket.end());
                    socket.pipe(stream);
                    socket.on('data', chunk => {
                        if (state.closed) {
                            return socket.destroy();
                        }
                        this._countBytesSent(state, chunk.length);
                    });
                });
                socket.on('error', () => {
                    if (!stream.headersSent) {
                        return this._respond(stream, 502, {error: 'site_unreachable'});
                    }
                    !stream.destroyed && stream.close(NGHTTP2_CANCEL);
                });
                stream.on('close', () => socket.destroy());
            })
            .catch(error => {
                console.log(`[vpn-exit] session ${state.session_id} refused ${host}:${port}: ${error}`);
                this._respond(stream, 403, {error});
                if (error === 'private_address') {
                    state.private_refused_count = (state.private_refused_count || 0) + 1;
                    if (state.private_refused_count === config.CLOUD_NOTICE_PRIVATE_PROBE_MIN && state.pass_type === 'certificate') {
                        cloudNotice.autoNotice(state.certificate, 'private_address_probe', {
                            refused_count: state.private_refused_count,
                            duration     : this._now() - state.connect_date
                        }, state.receipt, state.receipt_signature);
                    }
                }
            });
    }

    getSessionList() {
        return _.map([...this.sessionMap.values()], state => ({
            session_id         : state.session_id,
            authenticated      : state.authenticated,
            pass_type          : state.pass_type,
            escrow_address     : state.escrow_record?.escrow_address,
            certificate_id     : state.certificate?.certificate_id,
            broker_address     : state.certificate?.broker_address,
            pass_public_key    : state.pass_public_key,
            bytes_sent         : state.bytes_sent,
            bytes_received     : state.bytes_received,
            bytes_covered      : state.bytes_covered,
            receipt_total_bytes: state.receipt_total_bytes,
            receipt_sequence   : state.receipt_sequence,
            receipt            : state.receipt,
            site_list          : [...state.site_list],
            connect_date       : state.connect_date
        }));
    }

    isRunning() {
        return !!this.server;
    }

    /**
     * a connection that reached this exit node through its forwarding node
     * or by simultaneous connect, served as if the client had connected
     * directly
     */
    acceptConnection(socket, route) {
        if (!this.server) {
            return socket.destroy();
        }
        socket.vpnRoute = route;
        this.server.emit('connection', socket);
    }

    /**
     * the forwarding node in this exit node's offer: set when clients
     * cannot reach this node directly
     */
    getForwardEndpoint() {
        const forwardHost = this.forwardHost;
        if (!forwardHost || !forwardHost.registered || forwardHost.reachable) {
            return null;
        }
        return forwardHost.forward_endpoint;
    }

    _findForwardEndpoint() {
        return cloudOffer.listOffers({service: 'vpn_forward'}, 'create_date desc', 1000)
                         .then(offerList => _.find(offerList, offer => offer.node_id !== network.nodeID &&
                                                                     (!config.CLOUD_FORWARD_NODE_ID || offer.node_id === config.CLOUD_FORWARD_NODE_ID) &&
                                                                     cloudOffer.verifyOffer(offer).valid))
                         .then(offer => offer ? {
                             node_id     : offer.node_id,
                             node_address: offer.endpoint.node_address,
                             service_port: offer.endpoint.service_port
                         } : Promise.reject('forward_offer_not_found'));
    }

    /**
     * registers with a forwarding node. in auto mode the registration is kept
     * only when the forwarding node cannot reach this node's port.
     */
    _startForward() {
        if (!this.server || config.VPN_EXIT_FORWARD === 'never' || this.forwardHost) {
            return Promise.resolve();
        }
        const retry = () => {
            if (this.server && !this._forwardRetryTimer) {
                this._forwardRetryTimer = setTimeout(() => {
                    this._forwardRetryTimer = null;
                    this._startForward();
                }, config.CLOUD_FORWARD_RETRY_WAIT_TIME * 1000);
            }
        };
        return this._findForwardEndpoint()
                   .then(forwardEndpoint => {
                       const forwardHost = new ForwardHost(forwardEndpoint, config.NODE_PORT_VPN, (socket, route) => this.acceptConnection(socket, route));
                       this.forwardHost  = forwardHost;
                       return forwardHost.register()
                                         .then(({reachable}) => {
                                             if (reachable && config.VPN_EXIT_FORWARD === 'auto') {
                                                 console.log(`[vpn-exit] forwarding node ${forwardEndpoint.node_id} reaches this exit node directly: no forwarding needed`);
                                                 forwardHost.stop();
                                                 return;
                                             }
                                             forwardHost.reachable = false;
                                             console.log(`[vpn-exit] clients reach this exit node through forwarding node ${forwardEndpoint.node_id}`);
                                             eventBus.emit('vpn_exit_forward_update', this.getForwardEndpoint());
                                             eventBus.once('cloud_forward_host_closed', closedHost => {
                                                 if (closedHost === forwardHost && this.forwardHost === forwardHost && !forwardHost.stopped) {
                                                     console.log(`[vpn-exit] forwarding node ${forwardEndpoint.node_id} closed the registration`);
                                                     this.forwardHost = null;
                                                     eventBus.emit('vpn_exit_forward_update', null);
                                                     retry();
                                                 }
                                             });
                                         })
                                         .catch(error => {
                                             this.forwardHost = null;
                                             return Promise.reject(error);
                                         });
                   })
                   .catch(error => {
                       console.log(`[vpn-exit] no forwarding node: ${error}`);
                       retry();
                   });
    }

    initialize() {
        if (!config.MODE_VPN_EXIT || this.server) {
            return Promise.resolve();
        }
        if (!network.certificatePem) {
            return Promise.reject('node_certificate_not_found');
        }

        return new Promise((resolve) => {
            this.server = http2.createSecureServer({
                key       : network.certificatePrivateKeyPem,
                cert      : network.certificatePem,
                ecdhCurve : 'prime256v1',
                allowHTTP1: false
            });
            this.server.on('session', session => this._onSession(session));
            this.server.on('stream', (stream, headers) => this._onStream(stream, headers));
            this.server.on('error', error => console.log(`[vpn-exit] server error: ${error.message}`));
            const onReady = () => {
                task.scheduleTask('vpn_exit_receipt_report', this.reportReceipts.bind(this), config.CLOUD_BROKER_REPORT_INTERVAL * 1000, true);
                this._startForward();
                resolve();
            };
            if (config.VPN_EXIT_FORWARD === 'always') {
                // no open port: every client comes through the forwarding
                // node
                console.log('[vpn-exit] exit node reached only through a forwarding node');
                return onReady();
            }
            this.server.listen(config.NODE_PORT_VPN, config.NODE_BIND_IP, () => {
                console.log(`[vpn-exit] exit node listening on port ${config.NODE_PORT_VPN}`);
                onReady();
            });
        });
    }

    stop() {
        task.removeTask('vpn_exit_receipt_report');
        clearTimeout(this._forwardRetryTimer);
        this._forwardRetryTimer = null;
        if (this.forwardHost) {
            this.forwardHost.stop();
            this.forwardHost = null;
        }
        if (this.server) {
            [...this.sessionMap.values()].forEach(state => this._closeSession(state, 'node_stop'));
            try {
                this.server.close();
            }
            catch (e) {
            }
            this.server = null;
        }
    }
}


export default new VPNExit();
