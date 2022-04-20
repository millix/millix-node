import express from 'express';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import cors from 'cors';
import chunkUtils from './chunk-utils';
import https from 'https';
import walletUtils from '../wallet/wallet-utils';
import storageAcl from './storage-acl';
import request from 'request';
import network from '../../net/network';
import config from '../config/config';


class Sender {
    constructor() {
        this.httpsServer = null;
        this.app         = null;
    }

    initialize() {
        return walletUtils.loadNodeKeyAndCertificate()
                          .then(({
                                     certificate_private_key_pem: certificatePrivateKeyPem,
                                     certificate_pem            : certificatePem
                                 }) => {
                              const serverOptions = {
                                  key      : certificatePrivateKeyPem,
                                  cert     : certificatePem,
                                  ecdhCurve: 'prime256v1'
                              };
                              this._defineServerOperations();
                              return this._startSenderServer(serverOptions);
                          });
    }

    stop() {
        if (this.httpsServer) {
            this.httpsServer.close();
            this.httpsServer = null;
        }
    }

    _defineServerOperations() {
        this.app = express();
        this.app.use(helmet());
        this.app.use(bodyParser.json({limit: '50mb'}));
        this.app.use(cors());

        this.app.get('/file/:nodeId/:addressKeyIdentifier/:transactionDate/:transactionId/:fileHash/:chunkNumber', (req, res) => {
            const nodeId               = req.params.nodeId;
            const addressKeyIdentifier = req.params.addressKeyIdentifier;
            const transactionDate      = req.params.transactionDate;
            const transactionId        = req.params.transactionId;
            const fileHash             = req.params.fileHash;
            const chunkNumber          = req.params.chunkNumber;

            if (storageAcl.hasFileToSend(nodeId, transactionId, fileHash)) {
                chunkUtils.getChunk(addressKeyIdentifier, transactionDate, transactionId, fileHash, chunkNumber).then((data) => {
                    res.send(data);
                }).catch((err) => {
                    console.log('[file-sender] error', err);
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
            if (storageAcl.hasTransactionRequest(nodeId, transactionId)) {
                storageAcl.removeEntryFromSender(nodeId, transactionId);
                res.writeHead(200);
                res.end('ok');
            }
            else {
                res.writeHead(403);
                res.end('Requested file is not in queue to be send!');
            }
        });
    }

    _startSenderServer(serverOptions) {
        return new Promise((resolve, reject) => {
            this.httpsServer = https.createServer(serverOptions, this.app);
            this.httpsServer.listen(config.NODE_PORT_STORAGE_PROVIDER, config.NODE_BIND_IP, (err) => {
                if (err) {
                    console.log('[file-sender] error ', err);
                    return reject(err);
                }
                console.log('[file-sender] Server listening on port ' + config.NODE_PORT_STORAGE_PROVIDER);
                resolve();
            });
        });
    }

    getNumberOfChunks(addressKeyIdentifier, transactionDate, transactionId, fileHash) {
        return chunkUtils.getNumberOfChunks(addressKeyIdentifier, transactionDate, transactionId, fileHash);
    }

    serveFile(nodeId, addressKeyIdentifier, transactionId, fileHash) {
        return storageAcl.addNewFileToSender(nodeId, transactionId, fileHash);
    }

    sendChunk(receiverEndpoint, addressKeyIdentifier, transactionDate, transactionId, fileHash, chunkNumber) {
        return chunkUtils.getChunk(addressKeyIdentifier, transactionDate, transactionId, fileHash, chunkNumber).then((data) => {
            return new Promise((resolve, reject) => {
                request.post({
                    url      : receiverEndpoint.concat('/file/')
                                               .concat(network.nodeID).concat('/')
                                               .concat(addressKeyIdentifier).concat('/')
                                               .concat(transactionDate).concat('/')
                                               .concat(transactionId).concat('/')
                                               .concat(fileHash).concat('/')
                                               .concat(chunkNumber),
                    body     : data,
                    headers  : {
                        'Content-Type': 'application/octet-stream'
                    },
                    strictSSL: false
                }, (err) => {
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
