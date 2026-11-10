import _ from 'lodash';
import http2 from 'http2';
import net from 'net';
import crypto from 'crypto';
import network from '../network';
import config from '../../core/config/config';
import escrow from '../../core/wallet/escrow';
import walletEscrow from '../../core/wallet/wallet-escrow';
import database from '../../database/database';
import objectHash from '../../core/crypto/object-hash';
import signature from '../../core/crypto/signature';
import {resolvePublicAddress} from './address-filter';
import ntp from '../../core/ntp';
import eventBus from '../../core/event-bus';
import cloudVersion from '../cloud-version';
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
 *   that pays this node.
 * - CONNECT host:443 opens a tunnel to a site. only port 443 is accepted, the
 *   first bytes from the client must start a tls handshake, and sites whose
 *   name points to a private or local address are refused. the exit node
 *   sees the site name and the byte count, never the content.
 * - POST /vpn/receipt {receipt, signature} carries a receipt signed by the
 *   pass key with the running total of bytes received and a sequence.
 *
 * the session closes when the bytes sent run ahead of the receipts by more
 * than VPN_RECEIPT_GAP_BYTES_MAX, when the escrow's data is used up or after
 * VPN_SESSION_IDLE_TIME_MAX without traffic.
 */
class VPNExit {
    constructor() {
        this.server     = null;
        this.sessionMap = new Map();
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
                       .then(body => this._onReceipt(state, body))
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

        resolvePublicAddress(host)
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
            });
    }

    getSessionList() {
        return _.map([...this.sessionMap.values()], state => ({
            session_id         : state.session_id,
            authenticated      : state.authenticated,
            escrow_address     : state.escrow_record?.escrow_address,
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

    _onCloudVersionUpdate({cloud_enabled: isCloudEnabled}) {
        if (!isCloudEnabled && this.server) {
            console.log('[vpn-exit] this node version is below the minimum for cloud features: stopping the exit node');
            this.stop();
        }
        else if (isCloudEnabled && !this.server) {
            this.initialize().catch(_ => _);
        }
    }

    initialize() {
        if (!this._cloudVersionListener) {
            this._cloudVersionListener = this._onCloudVersionUpdate.bind(this);
            eventBus.on('cloud_version_min_update', this._cloudVersionListener);
        }
        if (!config.MODE_VPN_EXIT || this.server) {
            return Promise.resolve();
        }
        if (!cloudVersion.isCloudEnabled()) {
            console.log(`[vpn-exit] not started: this node version is below the minimum for cloud features (${cloudVersion.getVersionMin()})`);
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
            this.server.listen(config.NODE_PORT_VPN, config.NODE_BIND_IP, () => {
                console.log(`[vpn-exit] exit node listening on port ${config.NODE_PORT_VPN}`);
                resolve();
            });
        });
    }

    stop() {
        if (this.server) {
            [...this.sessionMap.values()].forEach(state => this._closeSession(state, 'node_stop'));
            this.server.close();
            this.server = null;
        }
    }
}


export default new VPNExit();
