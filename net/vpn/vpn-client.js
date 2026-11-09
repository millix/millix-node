import _ from 'lodash';
import http from 'http';
import http2 from 'http2';
import crypto from 'crypto';
import config from '../../core/config/config';
import database from '../../database/database';
import cloudOffer from '../cloud-offer';
import escrow from '../../core/wallet/escrow';
import walletEscrow from '../../core/wallet/wallet-escrow';
import walletUtils from '../../core/wallet/wallet-utils';
import objectHash from '../../core/crypto/object-hash';
import signature from '../../core/crypto/signature';
import ntp from '../../core/ntp';
import console from '../../core/console';

const {
          HTTP2_HEADER_METHOD,
          HTTP2_HEADER_PATH,
          HTTP2_HEADER_AUTHORITY,
          HTTP2_HEADER_STATUS,
          HTTP2_HEADER_CONTENT_TYPE,
          HTTP2_METHOD_CONNECT
      } = http2.constants;

const RECEIPT_HISTORY_MAX = 20;


/**
 * the user side of the tangled cloud vpn.
 *
 * opening a session against an offer funds an escrow for the exit node,
 * connects to the exit node over tls, checks that its certificate carries
 * the offer's node id, proves the pass key and starts a local proxy on
 * 127.0.0.1. the local proxy carries only CONNECT requests (https), each in
 * its own stream of the one connection to the exit node. every
 * VPN_RECEIPT_INTERVAL_BYTES received, and when a tunnel closes, the session
 * signs a receipt with the pass key stating the running total and a
 * sequence, and sends it to the exit node.
 */
class VPNClient {
    constructor() {
        this.sessionMap = new Map();
    }

    _now() {
        return Math.floor(ntp.now().getTime() / 1000);
    }

    _request(session, method, path, body) {
        return new Promise((resolve, reject) => {
            const headers = {
                [HTTP2_HEADER_METHOD]: method,
                [HTTP2_HEADER_PATH]  : path
            };
            if (body) {
                headers[HTTP2_HEADER_CONTENT_TYPE] = 'application/json';
            }
            const stream = session.request(headers);
            let status, data = '';
            stream.setEncoding('utf8');
            stream.on('response', responseHeaders => status = responseHeaders[HTTP2_HEADER_STATUS]);
            stream.on('data', chunk => data += chunk);
            stream.on('end', () => {
                let result;
                try {
                    result = JSON.parse(data);
                }
                catch (e) {
                    return reject('response_invalid');
                }
                status === 200 ? resolve(result) : reject(result.error || `status_${status}`);
            });
            stream.on('error', error => reject(error.message || error));
            body ? stream.end(JSON.stringify(body)) : stream.end();
        });
    }

    _connect(offer) {
        return new Promise((resolve, reject) => {
            const {
                      node_address: address,
                      service_port: port
                  }       = offer.endpoint;
            const session = http2.connect(`https://${address}:${port}`, {
                // the exit node is identified by the node id its certificate
                // carries, checked below, not by a certificate authority
                rejectUnauthorized : false,
                checkServerIdentity: () => undefined
            });
            session.on('error', error => reject(error.message || error));
            session.on('connect', (_, socket) => {
                let nodeID;
                try {
                    nodeID = walletUtils.getNodeIdFromCertificate(socket.getPeerCertificate().raw.toString('hex'), 'hex');
                }
                catch (e) {
                }
                if (nodeID !== offer.node_id) {
                    session.destroy();
                    return reject('exit_node_certificate_invalid');
                }
                resolve(session);
            });
        });
    }

    _authenticate(state) {
        const passPrivateKey = walletEscrow.getPassPrivateKey(state.terms.nonce);
        const startTime      = Date.now();
        const tryAuthenticate = () => this._request(state.session, 'GET', '/vpn/challenge')
                                          .then(({challenge, node_id: nodeID}) => {
                                              const challengeSignature = signature.sign(objectHash.getHashBuffer({
                                                  challenge,
                                                  node_id: nodeID
                                              }), passPrivateKey);
                                              return this._request(state.session, 'POST', '/vpn/session', {
                                                  pass               : {
                                                      terms                 : state.terms,
                                                      funding_transaction_id: state.funding_transaction_id
                                                  },
                                                  challenge_signature: challengeSignature
                                              });
                                          })
                                          .catch(error => {
                                              // the exit node may not have the funding
                                              // transaction yet
                                              if (error === 'escrow_not_funded' && Date.now() - startTime < config.VPN_AUTH_WAIT_TIME_MAX) {
                                                  return new Promise(resolve => setTimeout(resolve, 2000)).then(tryAuthenticate);
                                              }
                                              return Promise.reject(error);
                                          });
        return tryAuthenticate();
    }

    _sendReceipt(state) {
        if (state.closed || state.bytes_received <= state.receipt_total_bytes) {
            return;
        }
        const receipt = {
            version            : config.ESCROW_RECEIPT_VERSION,
            escrow_address_base: state.escrow_address_base,
            node_id            : state.node_id,
            total_bytes        : state.bytes_received,
            sequence           : state.receipt_sequence + 1,
            receipt_date       : this._now()
        };
        const receiptSignature    = escrow.signReceipt(receipt, walletEscrow.getPassPrivateKey(state.terms.nonce));
        state.receipt_total_bytes = receipt.total_bytes;
        state.receipt_sequence    = receipt.sequence;
        state.receipt_list.push({
            receipt,
            signature: receiptSignature,
            status   : 'sent'
        });
        if (state.receipt_list.length > RECEIPT_HISTORY_MAX) {
            state.receipt_list.shift();
        }
        const entry = _.last(state.receipt_list);
        this._request(state.session, 'POST', '/vpn/receipt', {
            receipt,
            signature: receiptSignature
        }).then(() => entry.status = 'accepted')
            .catch(error => entry.status = `rejected: ${error}`);
    }

    _countBytesReceived(state, byteCount) {
        state.bytes_received += byteCount;
        if (state.bytes_received - state.receipt_total_bytes >= config.VPN_RECEIPT_INTERVAL_BYTES) {
            this._sendReceipt(state);
        }
    }

    _onProxyConnect(state, request, clientSocket, head) {
        const tunnel = state.session.request({
            [HTTP2_HEADER_METHOD]   : HTTP2_METHOD_CONNECT,
            [HTTP2_HEADER_AUTHORITY]: request.url
        });
        clientSocket.on('error', () => tunnel.destroy());
        tunnel.on('error', () => clientSocket.destroy());
        tunnel.on('response', headers => {
            const status = headers[HTTP2_HEADER_STATUS];
            if (status !== 200) {
                let body = '';
                tunnel.setEncoding('utf8');
                tunnel.on('data', chunk => body += chunk);
                tunnel.on('end', () => clientSocket.end(`HTTP/1.1 ${status} Refused\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n${body}`));
                return;
            }
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length > 0) {
                tunnel.write(head);
            }
            tunnel.pipe(clientSocket);
            clientSocket.pipe(tunnel);
            tunnel.on('data', chunk => this._countBytesReceived(state, chunk.length));
        });
        tunnel.on('close', () => {
            clientSocket.destroy();
            this._sendReceipt(state);
        });
    }

    _startLocalProxy(state) {
        return new Promise((resolve, reject) => {
            const server = http.createServer((request, response) => {
                // only https sites go through the vpn
                response.writeHead(403, {'Content-Type': 'application/json'});
                response.end(JSON.stringify({error: 'https_only'}));
            });
            server.on('connect', (request, clientSocket, head) => this._onProxyConnect(state, request, clientSocket, head));
            server.on('error', reject);
            server.listen(0, '127.0.0.1', () => {
                state.local_proxy = server;
                resolve(server.address().port);
            });
        });
    }

    /**
     * @param offerID
     * @param portionCount how many portions of data to pay into the escrow
     * @param unlockAfter seconds until the payer can take back what is unused
     */
    openSession(offerID, portionCount, unlockAfter) {
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
                           if (offer.service !== 'vpn_exit' || !offer.escrow || !offer.endpoint.service_port) {
                               return Promise.reject('offer_not_vpn_exit');
                           }
                           return walletEscrow.createEscrow(offer.node_public_key, offer.node_id, offer.escrow.portion_bytes, offer.escrow.portion_amount, portionCount, this._now() + unlockAfter)
                                              .then(escrowData => [
                                                  offer,
                                                  escrowData
                                              ]);
                       })
                       .then(([offer, escrowData]) => {
                           const escrowAddress = escrow.getEscrowAddress(escrowData.terms);
                           const state         = {
                               session_id            : crypto.randomBytes(8).toString('hex'),
                               offer_id              : offer.offer_id,
                               node_id               : offer.node_id,
                               terms                 : escrowData.terms,
                               escrow_address        : escrowAddress.address,
                               escrow_address_base   : escrowAddress.address_base,
                               funding_transaction_id: escrowData.transaction.transaction_id,
                               bytes_received        : 0,
                               receipt_total_bytes   : 0,
                               receipt_sequence      : 0,
                               receipt_list          : [],
                               status                : 'connecting',
                               create_date           : this._now(),
                               closed                : false
                           };
                           this.sessionMap.set(state.session_id, state);
                           return this._connect(offer)
                                      .then(session => {
                                          state.session = session;
                                          session.on('close', () => this._onSessionClosed(state, 'connection_closed'));
                                          return this._authenticate(state);
                                      })
                                      .then(result => {
                                          state.exit_session_id     = result.session_id;
                                          state.bytes_covered       = result.bytes_covered;
                                          state.bytes_received      = result.receipt_total_bytes;
                                          state.receipt_total_bytes = result.receipt_total_bytes;
                                          state.receipt_sequence    = result.receipt_sequence;
                                          return this._startLocalProxy(state);
                                      })
                                      .then(port => {
                                          state.local_proxy_port = port;
                                          state.status           = 'connected';
                                          console.log(`[vpn-client] session ${state.session_id} connected to exit node ${state.node_id}, local proxy on 127.0.0.1:${port}`);
                                          return this.getSession(state.session_id);
                                      })
                                      .catch(error => {
                                          this._onSessionClosed(state, `${error}`);
                                          return Promise.reject(error);
                                      });
                       });
    }

    _onSessionClosed(state, reason) {
        if (state.closed) {
            return;
        }
        this._sendReceipt(state);
        state.closed       = true;
        state.status       = 'closed';
        state.close_reason = reason;
        state.local_proxy && state.local_proxy.close();
        setTimeout(() => state.session && !state.session.destroyed && state.session.destroy(), 1000);
        console.log(`[vpn-client] session ${state.session_id} closed: ${reason}`);
    }

    closeSession(sessionID) {
        const state = this.sessionMap.get(sessionID);
        if (!state) {
            return Promise.reject('session_not_found');
        }
        this._onSessionClosed(state, 'closed_by_user');
        return Promise.resolve(this.getSession(sessionID));
    }

    getSession(sessionID) {
        const state = this.sessionMap.get(sessionID);
        if (!state) {
            return null;
        }
        return _.pick(state, [
            'session_id',
            'offer_id',
            'node_id',
            'escrow_address',
            'funding_transaction_id',
            'local_proxy_port',
            'bytes_received',
            'bytes_covered',
            'receipt_total_bytes',
            'receipt_sequence',
            'receipt_list',
            'status',
            'close_reason',
            'create_date'
        ]);
    }

    listSession() {
        return _.map([...this.sessionMap.keys()], sessionID => this.getSession(sessionID));
    }

    stop() {
        [...this.sessionMap.values()].forEach(state => this._onSessionClosed(state, 'node_stop'));
    }
}


export default new VPNClient();
