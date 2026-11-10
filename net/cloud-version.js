import _ from 'lodash';
import network from './network';
import eventBus from '../core/event-bus';
import config from '../core/config/config';
import database from '../database/database';
import objectHash from '../core/crypto/object-hash';
import signature from '../core/crypto/signature';
import {NodeVersion} from '../core/utils/utils';
import ntp from '../core/ntp';
import console from '../core/console';

export const CLOUD_VERSION_MESSAGE_VERSION = 1;

const MESSAGE_KEY_LIST = [
    'version',
    'network',
    'version_min',
    'create_date',
    'signature'
].sort();
// the stored message, in the config table
const CONFIG_NAME      = 'CLOUD_VERSION_MIN_MESSAGE';


/**
 * the minimum node version for tangled cloud features, set by a message
 * signed with tangled's key (CLOUD_AUTHORITY_PUBLIC_KEY).
 *
 * the message names the network and the minimum version, and is dated. a
 * node keeps the newest valid message it has seen, sends it to every new
 * peer and forwards a newer one to all its peers. a node whose own version is
 * below the minimum turns its cloud features off (publishing offers, the vpn
 * exit node, vpn sessions, the broker, forwarding and notices), and every
 * node ignores offers from nodes below it. this ships in the first cloud
 * release so that later releases can switch older versions off.
 */
class CloudVersion {
    constructor() {
        this.message = null;
    }

    _now() {
        return Math.floor(ntp.now().getTime() / 1000);
    }

    _getNetworkName() {
        return config.MODE_TEST_NETWORK ? 'test' : 'main';
    }

    getMessageBody(message) {
        return _.omit(message, ['signature']);
    }

    /**
     * signs a minimum version message. used by tangled's signing tool and
     * the tests, never by a node.
     * @param versionMin
     * @param createDate unix time in seconds
     * @param privateKey 32 byte buffer of the key whose public key is
     * CLOUD_AUTHORITY_PUBLIC_KEY
     * @param networkName main or test
     */
    signVersionMin(versionMin, createDate, privateKey, networkName = this._getNetworkName()) {
        const body = {
            version    : CLOUD_VERSION_MESSAGE_VERSION,
            network    : networkName,
            version_min: versionMin,
            create_date: createDate
        };
        return {
            ...body,
            signature: signature.sign(objectHash.getHashBuffer(body), privateKey)
        };
    }

    /**
     * @param message
     * @return {{valid: boolean, reason?: string}}
     */
    verifyMessage(message) {
        if (!config.CLOUD_AUTHORITY_PUBLIC_KEY) {
            return {
                valid : false,
                reason: 'cloud_authority_not_set'
            };
        }

        if (!_.isPlainObject(message) || !_.isEqual(_.keys(message).sort(), MESSAGE_KEY_LIST) ||
            message.version !== CLOUD_VERSION_MESSAGE_VERSION || typeof message.version_min !== 'string' ||
            !/^\d+\.\d+\.\d+$/.test(message.version_min) || typeof message.signature !== 'string') {
            return {
                valid : false,
                reason: 'version_message_invalid_format'
            };
        }

        if (message.network !== this._getNetworkName()) {
            return {
                valid : false,
                reason: 'version_message_other_network'
            };
        }

        if (!Number.isInteger(message.create_date) || message.create_date <= 0 ||
            message.create_date > this._now() + config.CLOUD_OFFER_CLOCK_SKEW_TOLERANCE) {
            return {
                valid : false,
                reason: 'version_message_invalid_date'
            };
        }

        let isValidSignature;
        try {
            isValidSignature = signature.verify(objectHash.getHashBuffer(this.getMessageBody(message)), message.signature, config.CLOUD_AUTHORITY_PUBLIC_KEY);
        }
        catch (e) {
            isValidSignature = false;
        }
        if (!isValidSignature) {
            return {
                valid : false,
                reason: 'version_message_invalid_signature'
            };
        }

        return {valid: true};
    }

    getVersionMin() {
        return this.message ? this.message.version_min : config.CLOUD_NODE_VERSION_MIN;
    }

    /**
     * true if a node of this version may use cloud features
     */
    isVersionAccepted(version) {
        const nodeVersion = NodeVersion.fromString(version);
        return !!nodeVersion && nodeVersion.compareTo(NodeVersion.fromString(this.getVersionMin())) >= 0;
    }

    /**
     * true if this node's cloud features are on
     */
    isCloudEnabled() {
        return this.isVersionAccepted(config.NODE_MILLIX_VERSION);
    }

    /**
     * keeps the message if it is valid and newer than the one this node has
     * @return {Promise<boolean>} true if the message was new
     */
    addMessage(message) {
        const {
                  valid,
                  reason
              } = this.verifyMessage(message);
        if (!valid) {
            return Promise.reject(reason);
        }
        if (this.message && message.create_date <= this.message.create_date) {
            return Promise.resolve(false);
        }

        const wasEnabled = this.isCloudEnabled();
        this.message     = message;
        console.log(`[cloud-version] minimum version for cloud features is now ${message.version_min} (this node ${config.NODE_MILLIX_VERSION})`);
        if (wasEnabled !== this.isCloudEnabled()) {
            console.log(`[cloud-version] cloud features are ${this.isCloudEnabled() ? 'on' : 'off'}`);
        }
        eventBus.emit('cloud_version_min_update', {
            version_min  : message.version_min,
            cloud_enabled: this.isCloudEnabled()
        });

        const configRepository = database.getRepository('config');
        const value            = JSON.stringify(message);
        return configRepository.getConfig(CONFIG_NAME)
                               .then(row => row ? configRepository.updateConfig(CONFIG_NAME, value, 'object') : configRepository.addConfig(CONFIG_NAME, value, 'object'))
                               .then(() => true);
    }

    sendMessage(ws) {
        if (!this.message) {
            return;
        }
        const payload = {
            type   : 'cloud_version_min',
            content: {message: this.message}
        };
        eventBus.emit('node_event_log', payload);
        try {
            ws.nodeConnectionReady && ws.send(JSON.stringify(payload));
        }
        catch (e) {
            console.log('[WARN]: try to send data over a closed connection.');
            ws && ws.close();
        }
    }

    propagateMessage(excludeWS) {
        network.registeredClients.forEach(ws => ws !== excludeWS && this.sendMessage(ws));
    }

    _onMessage(content, ws) {
        eventBus.emit('node_event_log', {
            type: 'cloud_version_min',
            from: ws.node,
            content
        });
        this.addMessage(content?.message)
            .then(isNew => isNew && this.propagateMessage(ws))
            .catch(reason => console.log(`[cloud-version] message from node ${ws.nodeID} rejected: ${reason}`));
    }

    _onNewPeerConnection(ws) {
        ws.nodeConnectionReady && this.sendMessage(ws);
    }

    initialize() {
        this._newPeerConnectionListener = this._onNewPeerConnection.bind(this);
        eventBus.on('cloud_version_min', this._onMessage.bind(this));
        eventBus.on('peer_connection_new', this._newPeerConnectionListener);
        return database.getRepository('config')
                       .getConfig(CONFIG_NAME)
                       .then(row => {
                           if (!row) {
                               return;
                           }
                           const message = JSON.parse(row.value);
                           if (this.verifyMessage(message).valid) {
                               this.message = message;
                           }
                       })
                       .catch(_ => _)
                       .then(() => console.log(`[cloud-version] minimum version for cloud features ${this.getVersionMin()}, cloud features ${this.isCloudEnabled() ? 'on' : 'off'}`));
    }

    stop() {
        eventBus.removeAllListeners('cloud_version_min');
        if (this._newPeerConnectionListener) {
            eventBus.removeListener('peer_connection_new', this._newPeerConnectionListener);
            this._newPeerConnectionListener = null;
        }
    }
}


export default new CloudVersion();
