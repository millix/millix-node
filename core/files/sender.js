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


class Sender {
    constructor() {
        this.isSenderPublic  = true;
        this.filesRootFolder = null;
        this.serverOptions   = {};
        this.httpsServer     = null;
        this.app             = null;
    }

    initialize(isSenderPublic) {
        this.isSenderPublic  = isSenderPublic;
        return new Promise((resolve, reject) => {
            this._defineServerOperations();
            this.filesRootFolder = path.join(os.homedir(), config.FILES_CONNECTION.FOLDER);

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
                queue.initializeSender()
                     .then(() => {
                         resolve();
                     });
            });
        });
    }

    _defineServerOperations() {
        let filesRootFolder = this.filesRootFolder;
        this.app            = express();
        this.app.use(helmet());
        this.app.use(bodyParser.json({limit: '50mb'}));
        this.app.use(cors());

        this.app.get('/file/:nodeId/:walletId/:transactionId/:fileHash/:chunkNumber', (req, res) => {
            let nodeId        = req.params.nodeId;
            let walletId      = req.params.walletId;
            let transactionId = req.params.transactionId;
            let fileHash      = req.params.fileHash;
            let chunkNumber   = req.params.chunkNumber;
            let fileLocation  = path.join(filesRootFolder, walletId, transactionId, fileHash);

            if (queue.hasFileToSend(nodeId, transactionId, fileHash)) {
                chunker.getChunck(fileLocation, chunkNumber).then((data) => {
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
                queue.removeEntryFromSender(nodeId, transactionId);
                res.writeHead(200);
                res.end('ok');
            }
            else {
                res.writeHead(403);
                res.end('Requested file is not in queue to be send!');
            }
        });
    }

    getPublicSenderInfo() {
        if (!queue.anyActiveSenderServer()) {
            this.httpsServer = https.createServer(this.serverOptions, this.app).listen(0);
            console.log('[file-sender] Server listening on port ' + this.httpsServer.address().port);
        }
        queue.incrementServerInstancesInSender();
        return this.httpsServer;
    }

    serveFile(nodeId, transactionId, fileHash, nodePublicKey, nodeIsPublic) {
        return new Promise((resolve, reject) => {
            queue.addNewFileInSender(nodeId, transactionId, fileHash, nodePublicKey, nodeIsPublic);
            resolve();
        });
    }

    sendChunk(receiverServer, nodeId, walletId, transactionId, fileHash, chunkNumber) {
        return new Promise((resolve, reject) => {
            let fileLocation = path.join(filesRootFolder, walletId, transactionId, fileHash);
            chunker.getChunck(fileLocation, chunkNumber).then((data) => {
                let payload = {
                    url: receiverServer,
                    json: true,
                    body: JSON.stringify({
                        chunk: data
                    })
                };
                request.post(payload, (err, response, body) => {
                    if (err) {
                        console.log('[file-sender] error, ', err);
                        return reject(err);
                    }
                    resolve();
                });
            }).catch((err) => {
                return reject(err);
            });

        });
    }
}


export default new Sender();
