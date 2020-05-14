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
                app.use(bodyParser.json());

                // enabling CORS for all requests
                app.use(cors());

                // defining an endpoint to return all ads
                app.get('/', (req, res) => {
                    res.send(appInfo);
                });

                // apis
                apis.forEach(api => {
                    const module = require('./' + api.api_id + '/index');
                    if (module) {
                        module.default.register(app, api.permission);
                    }
                    else {
                        console.log('api source code not found');
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
                           .then(({private_key_pem: key, private_key: privateKey, certificate_pem: cert, public_key: publicKey, public_key_pem: publicKeyPem}) => {
                               // starting the server
                               const httpsServer = https.createServer({
                                   key,
                                   cert
                               }, app);

                               httpsServer.listen(config.NODE_PORT_API, () => {
                                   const nodeID = walletUtils.getNodeIdFromPublicKey(publicKey);
                                   this.nodeID  = nodeID;
                                   console.log(`[api] listening on port ${config.NODE_PORT_API}`);
                                   console.log(`[api] node_id ${nodeID}`);
                                   console.log(`[api] node_signature ${walletUtils.signNodeMessage(privateKey, nodeID)}`);
                                   const nodeRepository = database.getRepository('node');
                                   const nop            = () => {
                                   };
                                   nodeRepository.addNodeAttribute(nodeID, 'node_public_key', publicKeyPem.split(/\r\n/).splice(1, 4).join(''))
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
