import _ from 'lodash';
import base58 from 'bs58';
import network from './network';
import eventBus from '../core/event-bus';
import config from '../core/config/config';
import database from '../database/database';
import walletUtils from '../core/wallet/wallet-utils';
import objectHash from '../core/crypto/object-hash';
import ntp from '../core/ntp';
import task from '../core/task';
import console from '../core/console';
import vpnExit from './vpn/vpn-exit';
import cloudVersion from './cloud-version';
import broker from './broker/broker';
import cloudPass from './broker/cloud-pass';

export const CLOUD_OFFER_VERSION = 1;

const OFFER_KEY_LIST    = [
    'version',
    'node_id',
    'node_public_key',
    'node_version',
    'service',
    'location',
    'upload_speed_kbps',
    'endpoint',
    'broker_list',
    'create_date',
    'end_date',
    'offer_id',
    'signature'
].sort();
// optional: escrow, the price of each portion of data for services paid
// through an escrow (required for vpn_exit); broker, the terms of a broker
// signed by the broker key (required for broker)
const OFFER_OPTIONAL_KEY_LIST    = [
    'escrow',
    'broker'
];
const ENDPOINT_KEY_LIST          = [
    'node_prefix',
    'node_address',
    'node_port',
    'node_port_api'
].sort();
// optional: service_port, the port of the service itself (required for
// vpn_exit and broker)
const ENDPOINT_OPTIONAL_KEY_LIST = ['service_port'];


/**
 * a cloud offer is a signed record a node publishes about a tangled cloud
 * service it offers (vpn exit node, storage host). offers are immutable: to
 * change its terms a node publishes a new offer for the same service, which
 * replaces the older one. an offer past its end date stops counting.
 *
 * offers travel over the peer websocket connections: a node sends the offers
 * it knows to every new peer, and forwards every offer that is new to it to
 * all its peers, so they reach nodes that are not directly connected to the
 * publisher. publishing does not create a transaction.
 */
class CloudOffer {

    _now() {
        return Math.floor(ntp.now().getTime() / 1000);
    }

    _getOfferBody(offer) {
        return _.omit(offer, [
            'offer_id',
            'signature'
        ]);
    }

    _isPositiveInteger(value) {
        return Number.isInteger(value) && value > 0;
    }

    _isNonEmptyString(value, maxLength = 255) {
        return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
    }

    _verifyBroker(broker) {
        if (!_.isPlainObject(broker) || !_.isEqual(_.keys(broker).sort(), [
            'address',
            'public_key'
        ]) || !this._isNonEmptyString(broker.address) || !this._isNonEmptyString(broker.public_key)) {
            return false;
        }

        try {
            const {address: addressBase} = database.getRepository('address').getAddressComponent(broker.address);
            return walletUtils.isValidAddress(addressBase) &&
                   walletUtils.getAddressFromPublicKey(base58.decode(broker.public_key)) === addressBase;
        }
        catch (e) {
            return false;
        }
    }

    /**
     * checks that the offer is well formed, that it was signed by the key of
     * the node it names, that its id matches its content and that it has not
     * ended.
     * @param offer
     * @return {{valid: boolean, reason?: string}}
     */
    verifyOffer(offer) {
        if (!_.isPlainObject(offer)) {
            return {
                valid : false,
                reason: 'offer_invalid_format'
            };
        }

        if (JSON.stringify(offer).length > config.CLOUD_OFFER_SIZE_MAX) {
            return {
                valid : false,
                reason: 'offer_too_large'
            };
        }

        if (offer.version !== CLOUD_OFFER_VERSION || !_.isEqual(_.without(_.keys(offer), ...OFFER_OPTIONAL_KEY_LIST).sort(), OFFER_KEY_LIST)) {
            return {
                valid : false,
                reason: 'offer_invalid_format'
            };
        }

        // offers from nodes below the minimum version for cloud features
        // do not count
        if (!cloudVersion.isVersionAccepted(offer.node_version)) {
            return {
                valid : false,
                reason: 'offer_node_version_not_accepted'
            };
        }

        if (!config.CLOUD_OFFER_SERVICE_LIST.includes(offer.service)) {
            return {
                valid : false,
                reason: 'offer_invalid_service'
            };
        }

        const location = offer.location;
        if (!_.isPlainObject(location) || !/^[A-Z]{2}$/.test(location.country) ||
            _.some(_.keys(location), key => !['country', 'city'].includes(key)) ||
            (location.city !== undefined && !this._isNonEmptyString(location.city, 100))) {
            return {
                valid : false,
                reason: 'offer_invalid_location'
            };
        }

        if (!this._isPositiveInteger(offer.upload_speed_kbps)) {
            return {
                valid : false,
                reason: 'offer_invalid_upload_speed'
            };
        }

        const endpoint = offer.endpoint;
        if (!_.isPlainObject(endpoint) || !_.isEqual(_.without(_.keys(endpoint), ...ENDPOINT_OPTIONAL_KEY_LIST).sort(), ENDPOINT_KEY_LIST) ||
            !this._isNonEmptyString(endpoint.node_prefix, 10) || !this._isNonEmptyString(endpoint.node_address, 255) ||
            !this._isPositiveInteger(endpoint.node_port) || !this._isPositiveInteger(endpoint.node_port_api) ||
            (endpoint.service_port !== undefined && !this._isPositiveInteger(endpoint.service_port)) ||
            (['vpn_exit', 'broker'].includes(offer.service) && endpoint.service_port === undefined)) {
            return {
                valid : false,
                reason: 'offer_invalid_endpoint'
            };
        }

        const escrowTerms = offer.escrow;
        if ((escrowTerms !== undefined && (!_.isPlainObject(escrowTerms) || !_.isEqual(_.keys(escrowTerms).sort(), [
            'portion_amount',
            'portion_bytes'
        ]) || !this._isPositiveInteger(escrowTerms.portion_bytes) || escrowTerms.portion_bytes < config.ESCROW_PORTION_BYTES_MIN ||
                                         !this._isPositiveInteger(escrowTerms.portion_amount))) ||
            (offer.service === 'vpn_exit' && escrowTerms === undefined)) {
            return {
                valid : false,
                reason: 'offer_invalid_escrow'
            };
        }

        // a broker offer carries the broker's terms signed by the broker key
        // for this node
        if ((offer.broker !== undefined || offer.service === 'broker') &&
            (offer.service !== 'broker' || !cloudPass.isValidBrokerTerms(offer.broker, offer.node_id))) {
            return {
                valid : false,
                reason: 'offer_invalid_broker'
            };
        }

        if (!Array.isArray(offer.broker_list) || offer.broker_list.length === 0 ||
            offer.broker_list.length > config.CLOUD_OFFER_BROKER_MAX || !_.every(offer.broker_list, broker => this._verifyBroker(broker))) {
            return {
                valid : false,
                reason: 'offer_invalid_broker_list'
            };
        }

        const now = this._now();
        if (!this._isPositiveInteger(offer.create_date) || !this._isPositiveInteger(offer.end_date) ||
            offer.create_date > now + config.CLOUD_OFFER_CLOCK_SKEW_TOLERANCE ||
            offer.end_date <= offer.create_date ||
            offer.end_date - offer.create_date > config.CLOUD_OFFER_DURATION_MAX) {
            return {
                valid : false,
                reason: 'offer_invalid_date'
            };
        }

        if (offer.end_date <= now) {
            return {
                valid : false,
                reason: 'offer_expired'
            };
        }

        let body;
        try {
            body = this._getOfferBody(offer);
            if (objectHash.getCHash288(body) !== offer.offer_id) {
                return {
                    valid : false,
                    reason: 'offer_invalid_id'
                };
            }
        }
        catch (e) {
            return {
                valid : false,
                reason: 'offer_invalid_format'
            };
        }

        // the node id is derived from the public key the node certificate
        // carries, the same check the handshake does for a node identity
        if (!this._isNonEmptyString(offer.signature) || !walletUtils.isValidNodeIdentity(offer.node_id, offer.node_public_key, body, offer.signature)) {
            return {
                valid : false,
                reason: 'offer_invalid_signature'
            };
        }

        return {valid: true};
    }

    /**
     * creates, signs, stores and propagates an offer for this node
     * @param service
     * @param location {country, city}
     * @param uploadSpeedKbps
     * @param brokerList [{address, public_key}]
     * @param endDate unix time in seconds
     * @return {Promise<Object>} the signed offer
     */
    publishOffer(service, location, uploadSpeedKbps, brokerList, endDate) {
        if (!network.initialized || !network.nodePrivateKey) {
            return Promise.reject('network_not_initialized');
        }
        if (!cloudVersion.isCloudEnabled()) {
            return Promise.reject('cloud_version_not_accepted');
        }
        if (service === 'vpn_exit' && !vpnExit.isRunning()) {
            return Promise.reject('vpn_exit_not_running');
        }
        if (service === 'broker' && !broker.isRunning()) {
            return Promise.reject('broker_not_running');
        }

        const cloudOfferRepository = database.getRepository('cloud_offer');
        return cloudOfferRepository.getOffer(network.nodeID, service)
                                   .then(previousOffer => {
                                       let createDate = this._now();
                                       // the new offer must be newer than
                                       // the one it replaces
                                       if (previousOffer && previousOffer.create_date >= createDate) {
                                           createDate = previousOffer.create_date + 1;
                                       }

                                       const endpoint = {
                                           node_prefix  : config.WEBSOCKET_PROTOCOL,
                                           node_address : network.nodePublicIp,
                                           node_port    : config.NODE_PORT,
                                           node_port_api: config.NODE_PORT_API
                                       };
                                       const body     = {
                                           version          : CLOUD_OFFER_VERSION,
                                           node_id          : network.nodeID,
                                           node_public_key  : network.nodePublicKey,
                                           node_version     : config.NODE_MILLIX_VERSION,
                                           service,
                                           location         : _.omitBy({
                                               country: location.country,
                                               city   : location.city
                                           }, _.isNil),
                                           upload_speed_kbps: uploadSpeedKbps,
                                           endpoint,
                                           broker_list      : brokerList,
                                           create_date      : createDate,
                                           end_date         : endDate
                                       };
                                       if (service === 'vpn_exit') {
                                           endpoint.service_port = config.NODE_PORT_VPN;
                                           body.escrow           = {
                                               portion_bytes : config.VPN_ESCROW_PORTION_BYTES,
                                               portion_amount: config.VPN_ESCROW_PORTION_AMOUNT
                                           };
                                       }
                                       else if (service === 'broker') {
                                           endpoint.service_port = config.NODE_PORT_BROKER;
                                           try {
                                               body.broker = broker.getTerms();
                                           }
                                           catch (e) {
                                               return Promise.reject(e.message || e);
                                           }
                                       }

                                       let offer;
                                       try {
                                           offer = {
                                               ...body,
                                               offer_id : objectHash.getCHash288(body),
                                               signature: walletUtils.signMessage(network.nodePrivateKey, body)
                                           };
                                       }
                                       catch (e) {
                                           return Promise.reject('offer_invalid_format');
                                       }

                                       const {
                                                 valid,
                                                 reason
                                             } = this.verifyOffer(offer);
                                       if (!valid) {
                                           return Promise.reject(reason);
                                       }

                                       return cloudOfferRepository.addOffer(offer)
                                                                  .then(stored => {
                                                                      if (!stored) {
                                                                          return Promise.reject('offer_not_stored');
                                                                      }
                                                                      console.log(`[cloud-offer] published offer ${offer.offer_id} for service ${service}`);
                                                                      this.propagateOfferList([offer]);
                                                                      return offer;
                                                                  });
                                   });
    }

    listOffers(where, orderBy, limit) {
        return database.getRepository('cloud_offer').listOffers(where, orderBy, limit);
    }

    sendOfferList(offerList, ws) {
        _.each(_.chunk(offerList, config.CLOUD_OFFER_LIST_SIZE_MAX), offerListChunk => {
            const payload = {
                type   : 'cloud_offer_list',
                content: {offer_list: offerListChunk}
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

    propagateOfferList(offerList, excludeWS) {
        if (offerList.length === 0) {
            return;
        }

        network.registeredClients.forEach(ws => {
            if (ws !== excludeWS) {
                this.sendOfferList(offerList, ws);
            }
        });
    }

    _onOfferList(content, ws) {
        eventBus.emit('node_event_log', {
            type: 'cloud_offer_list',
            from: ws.node,
            content
        });

        if (!content || !Array.isArray(content.offer_list)) {
            return;
        }

        const cloudOfferRepository = database.getRepository('cloud_offer');
        const newOfferList         = [];
        const offerList            = content.offer_list.slice(0, config.CLOUD_OFFER_LIST_SIZE_MAX);

        Promise.all(offerList.map(offer => {
            const {
                      valid,
                      reason
                  } = this.verifyOffer(offer);
            if (!valid) {
                console.log(`[cloud-offer] offer ${offer && offer.offer_id} from node ${ws.nodeID} rejected: ${reason}`);
                return Promise.resolve();
            }

            return cloudOfferRepository.hasOffer(offer.offer_id)
                                       .then(isKnown => {
                                           if (isKnown) {
                                               return;
                                           }
                                           return cloudOfferRepository.addOffer(offer)
                                                                      .then(stored => {
                                                                          if (stored) {
                                                                              console.log(`[cloud-offer] new offer ${offer.offer_id} from node ${offer.node_id} for service ${offer.service} received from node ${ws.nodeID}`);
                                                                              newOfferList.push(offer);
                                                                          }
                                                                      });
                                       })
                                       .catch(err => console.log(`[cloud-offer] error storing offer ${offer.offer_id}: ${err}`));
        })).then(() => this.propagateOfferList(newOfferList, ws));
    }

    _onNewPeerConnection(ws) {
        if (!ws.nodeConnectionReady) {
            return;
        }

        this.listOffers(undefined, 'create_date desc', 1000)
            .then(offerList => this.sendOfferList(offerList, ws))
            .catch(_ => _);
    }

    _pruneExpiredOffers() {
        return database.getRepository('cloud_offer').removeExpiredOffers();
    }

    initialize() {
        // peer_connection_new has other listeners, keep a reference to
        // remove only this one on stop
        this._newPeerConnectionListener = this._onNewPeerConnection.bind(this);
        eventBus.on('cloud_offer_list', this._onOfferList.bind(this));
        eventBus.on('peer_connection_new', this._newPeerConnectionListener);
        task.scheduleTask('cloud_offer_prune', this._pruneExpiredOffers.bind(this), config.CLOUD_OFFER_PRUNE_WAIT_TIME, true);
        return Promise.resolve();
    }

    stop() {
        eventBus.removeAllListeners('cloud_offer_list');
        if (this._newPeerConnectionListener) {
            eventBus.removeListener('peer_connection_new', this._newPeerConnectionListener);
            this._newPeerConnectionListener = null;
        }
        task.removeTask('cloud_offer_prune');
    }
}


export default new CloudOffer();
