import express from 'express';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import cors from 'cors';
import chunker from './chunker';
import path from 'path';
import os from 'os';
import config, {NODE_BIND_IP} from '../config/config';
import https from 'https';
import walletUtils from '../wallet/wallet-utils';
import queue from './queue';
import request from 'request';
import async from 'async';
import network from '../../net/network';


class Receiver {
    constructor() {
        this.serverOptions = {};
        this.httpsServer   = null;
        this.app           = null;
        this.nodeId        = null;
    }

    initialize() {
        return new Promise((resolve, reject) => {
            this.nodeId = network.nodeID;
            this._defineServerOperations();
            walletUtils.loadNodeKeyAndCertificate()
                       .then(({
                                  certificate_private_key_pem: certificatePrivateKeyPem,
                                  certificate_pem            : certificatePem,
                                  node_private_key           : nodePrivateKey,
                                  node_public_key            : nodePublicKey
                              }) => {
                           this.serverOptions = {
                               key      : certificatePrivateKeyPem,
                               cert     : certificatePem,
                               ecdhCurve: 'prime256v1'
                           };
                           resolve();
                       }).then(() => {
                queue.initializeReceiver()
                     .then(() => {
                         resolve();
                     });
            });
        });
    }

    getPublicReceiverInfo() {
        if (!queue.anyActiveReceiverServer()) {
            this.httpsServer = https.createServer(this.serverOptions, this.app).listen(0);
            console.log('[file-receiver] Server listening on port ' + this.httpsServer.address().port);
        }
        queue.incrementServerInstancesInReceiver();
        return this.httpsServer;
    }

    _defineServerOperations() {
        this.app = express();
        this.app.use(helmet());
        this.app.use(bodyParser.json({limit: '50mb'}));
        this.app.use(cors());

        this.app.post('/file/:nodeId/:addressKeyIdentifier/:transactionId/:fileHash/:chunkNumber', (req, res) => {
            let nodeId               = req.params.nodeId;
            let addressKeyIdentifier = req.params.addressKeyIdentifier;
            let transactionId        = req.params.transactionId;
            let fileHash             = req.params.fileHash;
            let chunkNumber          = req.params.chunkNumber;

            if (queue.hasChunkToReceive(nodeId, transactionId, fileHash, chunkNumber)){
                let chunk = req.body.chunk;
                chunker.writeFile(addressKeyIdentifier, transactionId, fileHash, chunk);
                if(queue.isLastChunk(nodeId, transactionId, fileHash, chunkNumber)){
                    queue.removeEntryFromReceiver(nodeId, transactionId, fileHash, chunkNumber);
                    if(!queue.hasMoreFilesToReceiveFromServer(nodeId, transactionId)){
                        queue.decrementServerInstancesInReceiver();
                    }
                }
                res.writeHead(200);
                res.end('ok');
            } else {
                res.writeHead(403);
                res.end('Requested file is not in queue to be send!');
            }
        });
    }

    registerFileChunk(nodeId, transactionId, fileHash, nodePublicKey, numberOfChunks, requestedChunk) {
        queue.addNewChunkInReceiver(nodeId, transactionId, fileHash, nodePublicKey, numberOfChunks, requestedChunk);
    }

    receive(server, requestedFiles) {
        return new Promise((resolve, reject) => {
            const self                 = this;
            const addressKeyIdentifier = requestedFiles.addressKeyIdentifier;
            const transactionId        = requestedFiles.transactionId;
            const promisesToReceive    = requestedFiles.files.map(file => new Promise((resolve, reject) => {
                async.times(file.chunks, (chunkNumber, next) => {
                    const service = server.concat('/file/')
                                          .concat(self.nodeId).concat('/')
                                          .concat(addressKeyIdentifier).concat('/')
                                          .concat(transactionId).concat('/')
                                          .concat(file.name).concat('/')
                                          .concat(chunkNumber);
                    request.get(service, (err, response, body) => {
                        if (err) {
                            console.log('[file-receiver] error, ', err);
                            return next(err);
                        }
                        chunker.writeFile(wallet, transactionId, file.name, body).then(() => {
                            next();
                        }).catch((err) => {
                            return next(err);
                        });
                    });
                }, (err) => {
                    if (err) {
                        return reject();
                    }
                    return resolve();
                });

            }));

            Promise.all(promisesToReceive)
                   .then(() => {
                       return new Promise((resolve, reject) => {
                           const service = server.concat('/ack/')
                                                 .concat(self.nodeId).concat('/')
                                                 .concat(transactionId).concat('/');
                           request.post(service, (err, response, body) => {
                               if (err) {
                                   console.log('[file-receiver] error, ', err);
                                   return reject();
                               }
                               resolve();
                           });
                       });
                   }).then(() => {
                resolve();
            }).catch((err) => {
                return reject(err);
            });
        });
    }


}


export default new Receiver();
