import network from '../net/network';
import forge from 'node-forge';
import base58 from 'bs58';
import database from '../database/database';
import walletUtils from '../core/wallet/wallet-utils';

export default class Endpoint {
    constructor(endpoint) {
        this.endpoint = endpoint;
        this.baseURL  = '/api/:nodeID/:nodeSignature/';
    }

    handler() {
        throw new Error('You must to implement the method handler!');
    }

    onRequest(app, permission, req, res) {
        if (permission.require_identity) {
            const {nodeID, nodeSignature} = req.params;
            database.getRepository('node')
                    .getNodeAttribute(nodeID, 'node_public_key')
                    .then(publicKeyPem => {
                        const publicKey = walletUtils.publicKeyFromPem(publicKeyPem.match(/.{1,64}/g).join('\n'));
                        const md        = forge.md.sha1.create();
                        md.update(network.nodeID, 'utf8');
                        if (!publicKey.verify(md.digest().bytes(), base58.decode(nodeSignature))) {
                            return res.status(401).send({status: 'invalid_node_identity'});
                        }

                        if (permission.private && network.nodeID !== nodeID) {
                            return res.status(401).send({status: 'permission_denied'});
                        }

                        this.handler(app, req, res);
                    })
                    .catch(() => {
                        return res.status(401).send({status: 'node_identity_not_verified'});
                    });
        }
        else {
            this.handler(app, req, res);
        }
    }

    register(app, permission) {
        app.post(this.baseURL + this.endpoint, this.onRequest.bind(this, app, permission));
        app.get(this.baseURL + this.endpoint, this.onRequest.bind(this, app, permission));
    }
}
