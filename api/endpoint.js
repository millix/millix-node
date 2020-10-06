import database from '../database/database';
import walletUtils from '../core/wallet/wallet-utils';
import server from './server';

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
                    .then(publicKey => {
                        if (!publicKey) {
                            return res.status(401).send({
                                api_status : 'fail',
                                api_message: 'unknown node identity'
                            });
                        }
                        else if (!walletUtils.verify(publicKey, nodeSignature, server.nodeID)) {
                            return res.status(401).send({
                                api_status : 'fail',
                                api_message: 'invalid node identity'
                            });
                        }

                        if (permission.private && server.nodeID !== nodeID) {
                            return res.status(401).send({
                                api_status : 'fail',
                                api_message: 'permission denied'
                            });
                        }

                        this.handler(app, req, res);
                    })
                    .catch(e => res.send({
                        api_status : 'fail',
                        api_message: `unexpected generic api error: (${e})`
                    }));
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
