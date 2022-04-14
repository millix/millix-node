import express from 'express';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import cors from 'cors';
import chunkUtils from './chunk-utils';
import https from 'https';
import walletUtils from '../wallet/wallet-utils';
import queue from './queue';
import request from 'request';
import eventBus from '../event-bus';
import network from '../../net/network';
import fileManager from './file-manager';
import peer from '../../net/peer';
import _ from 'lodash';


class Sender {
    constructor() {
        this.serverOptions = {};
        this.httpsServer   = null;
        this.app           = null;
    }

    initialize() {
        return walletUtils.loadNodeKeyAndCertificate()
                          .then(({
                                     certificate_private_key_pem: certificatePrivateKeyPem,
                                     certificate_pem            : certificatePem
                                 }) => {
                              this.serverOptions = {
                                  key      : certificatePrivateKeyPem,
                                  cert     : certificatePem,
                                  ecdhCurve: 'prime256v1'
                              };
                              this._defineServerOperations();
                          })
                          .then(() => queue.initializeSender());
    }

    _defineServerOperations() {
        this.app = express();
        this.app.use(helmet());
        this.app.use(bodyParser.json({limit: '50mb'}));
        this.app.use(cors());

        this.app.get('/file/:nodeId/:addressKeyIdentifier/:transactionId/:fileHash/:chunkNumber', (req, res) => {
            let nodeId               = req.params.nodeId;
            let addressKeyIdentifier = req.params.addressKeyIdentifier;
            let transactionId        = req.params.transactionId;
            let fileHash             = req.params.fileHash;
            let chunkNumber          = req.params.chunkNumber;

            if (queue.hasFileToSend(nodeId, transactionId, fileHash)) {
                chunkUtils.getChunk(addressKeyIdentifier, transactionId, fileHash, chunkNumber).then((data) => {
                    res.writeHead(200);
                    res(data);
                }).catch(() => {
                    res.writeHead(403);
                    res.end('Requested file cannot be sent!');
                });
            }
            else {
                res.writeHead(403);
                res.end('Requested file is not in queue to be send!');
            }
        });

        this.app.post('/ack/:nodeId/:transactionId', function(req, res) {
            let nodeId        = req.params.nodeId;
            let transactionId = req.params.transactionId;
            if (queue.hasTransactionRequest(nodeId, transactionId)) {
                queue.decrementServerInstancesInSender();
                queue.removeEntryFromSender(nodeId, transactionId).then(_ => _);
                res.writeHead(200);
                res.end('ok');
            }
            else {
                res.writeHead(403);
                res.end('Requested file is not in queue to be send!');
            }
        });
    }

    newSenderInstance() {
        if (!queue.isSenderServerActive()) {
            this.httpsServer = https.createServer(this.serverOptions, this.app).listen(config.NODE_PORT_STORAGE_PROVIDER, config.NODE_BIND_IP);
            console.log('[file-sender] Server listening on port ' + config.NODE_PORT_STORAGE_PROVIDER);
        }
        queue.incrementServerInstancesInSender();
        return this.httpsServer;
    }

    getNumberOfChunks(addressKeyIdentifier, transactionId, fileHash) {
        return chunkUtils.getNumberOfChunks(addressKeyIdentifier, transactionId, fileHash);
    }

    serveFile(nodeId, addressKeyIdentifier, transactionId, fileHash) {
        return queue.addNewFileToSender(nodeId, transactionId, fileHash);
    }

    sendChunk(receiverEndpoint, addressKeyIdentifier, transactionId, fileHash, chunkNumber) {
        return chunkUtils.getChunk(addressKeyIdentifier, transactionId, fileHash, chunkNumber).then((data) => {
            let payload = {
                url : receiverEndpoint.concat('/file/')
                                      .concat(network.nodeID).concat('/')
                                      .concat(addressKeyIdentifier).concat('/')
                                      .concat(transactionId).concat('/')
                                      .concat(fileHash).concat('/')
                                      .concat(chunkNumber),
                body: {
                    chunk: data
                }
            };
            return new Promise((resolve, reject) => {
                request.post(payload, {}, (err, response, body) => {
                    if (err) {
                        console.log('[file-sender] error, ', err);
                        return reject(err);
                    }
                    resolve();
                });
            });
        });
    }
}


export default new Sender();
