// importing the dependencies
import https from 'https';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import helmet from 'helmet';
import config from '../core/config/config';
import async from 'async';
import database from '../database/database';
import apiConfig from '../core/config/api.json';
import _ from 'lodash';
import base58 from 'bs58';
import walletUtils from '../core/wallet/wallet-utils';


class Server {
    constructor() {
        this.started = false;
    }

    _loadAPI() {
        return new Promise(resolve => {
            const apiRepository = database.getRepository('api');
            async.eachSeries(apiConfig.endpoint_list, (api, callback) => {
                apiRepository.addAPI(api)
                             .then(() => callback());
            }, () => {
                apiRepository.list()
                             .then(apis => resolve(apis));
            });
        });
    }

    initialize() {
        return new Promise(resolve => {
            if (this.started) {
                return resolve();
            }

            this.started = true;

            this._loadAPI().then(apis => {
                _.each(apis, api => api.permission = JSON.parse(api.permission));
                // defining the Express app
                const app = express();

                const appInfo = {
                    name   : 'millix',
                    version: config.NODE_MILLIX_VERSION
                };

                // adding Helmet to enhance your API's
                // security
                app.use(helmet());

                // using bodyParser to parse JSON bodies
                // into JS objects
                app.use(bodyParser.json({limit: '50mb'}));

                // enabling CORS for all requests
                app.use(cors());

                // defining an endpoint to return all ads
                app.get('/', (req, res) => {
                    res.send(appInfo);
                });

                // apis
                apis.forEach(api => {
                    let module;
                    try {
                        module = require('./' + api.api_id + '/index');
                    }
                    catch (e) {
                    }

                    if (module) {
                        module.default.register(app, api.permission);
                    }
                    else {
                        console.log('api source code not found');
                        database.getRepository('api').removeAPI(api.api_id);
                    }
                });

                app.use(function(err, req, res, next) {
                    if (err.name === 'UnauthorizedError') {
                        res.status(err.status).send({error: err.message});
                        return;
                    }
                    next();
                });

                walletUtils.loadNodeKeyAndCertificate()
                           .then(({certificate_private_key_pem: certificatePrivateKeyPem, certificate_pem: certificatePem, node_private_key: nodePrivateKey, node_public_key: nodePublicKey}) => {
                               // starting the server
                               const httpsServer = https.createServer({
                                   key      : certificatePrivateKeyPem,
                                   cert     : certificatePem,
                                   ecdhCurve: 'prime256v1'
                               }, app);

                               httpsServer.listen(config.NODE_PORT_API, config.NODE_BIND_IP, () => {
                                   console.log(`[api] listening on port ${config.NODE_PORT_API}`);
                                   this.nodeID         = walletUtils.getNodeIdFromCertificate(certificatePem, 'pem');
                                   this.nodePrivateKey = nodePrivateKey;
                                   console.log(`[api] node_id ${this.nodeID}`);
                                   let nodeSignature = walletUtils.signMessage(nodePrivateKey, this.nodeID);
                                   console.log(`[api] node_signature ${nodeSignature}`);
                                   walletUtils.storeNodeData({
                                       node_id       : this.nodeID,
                                       node_signature: nodeSignature
                                   }).then(_ => _).catch(_ => _);
                                   const nodeRepository = database.getRepository('node');
                                   const nop            = () => {
                                   };
                                   nodeRepository.addNodeAttribute(this.nodeID, 'node_public_key', base58.encode(nodePublicKey.toBuffer()))
                                                 .then(nop)
                                                 .catch(nop);
                               });
                               resolve();
                           });

            });
        });
    }
}


export default new Server();
