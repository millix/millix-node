import express from 'express';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import cors from 'cors';
import chunkUtils from './chunk-utils';
import https from 'https';
import walletUtils from '../wallet/wallet-utils';
import queue from './queue';
import request from 'request';
import async from 'async';
import network from '../../net/network';
import eventBus from '../event-bus';
import mutex from '../mutex';


class Receiver {
    constructor() {
        this.serverOptions = {};
        this.httpsServer   = null;
        this.app           = null;
        this.nodeId        = null;
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
                              this.nodeId        = network.nodeID;
                              this._defineServerOperations();
                          }).then(() => queue.initializeReceiver());
    }

    newReceiverInstance() {
        if (!queue.isReceiverServerActive()) {
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

            if (queue.hasChunkToReceive(nodeId, transactionId, fileHash, chunkNumber)) {
                let chunk = req.body.chunk;
                chunkUtils.writeFileChunk(addressKeyIdentifier, transactionId, fileHash, chunk)
                          .then(() => {
                              if (queue.isLastChunk(nodeId, transactionId, fileHash, chunkNumber)) {
                                  queue.decrementServerInstancesInReceiver();
                              }
                              queue.removeEntryFromReceiver(nodeId, transactionId, fileHash, chunkNumber).then(_ => _);
                              eventBus.emit('transaction_file_chunk_response', req.params);
                              res.writeHead(200);
                              res.end('ok');
                          });
            }
            else {
                res.writeHead(403);
                res.end('Requested file is not in queue to be send!');
            }
        });
    }

    registerFileChunk(nodeId, transactionId, fileHash, nodePublicKey, numberOfChunks, requestedChunk) {
        return queue.addNewChunkInReceiver(nodeId, transactionId, fileHash, nodePublicKey, numberOfChunks, requestedChunk);
    }

    downloadFileList(serverEndpoint, fileList) {
        return new Promise((resolve, reject) => {
            mutex.lock(['file-downloader'], unlock => {
                const addressKeyIdentifier           = fileList.addressKeyIdentifier;
                const transactionId                  = fileList.transactionId;
                const promisesToDownloadFileByChunks = fileList.files.map(file => new Promise((resolve, reject) => {
                    async.times(file.chunks, (chunkNumber, callback) => {
                        const url = serverEndpoint.concat('/file/')
                                                  .concat(this.nodeId).concat('/')
                                                  .concat(addressKeyIdentifier).concat('/')
                                                  .concat(transactionId).concat('/')
                                                  .concat(file.name).concat('/')
                                                  .concat(chunkNumber);
                        request.get(url, {}, (err, response, body) => {
                            if (err) {
                                console.log('[file-receiver] error, ', err);
                                return callback({
                                    error       : err,
                                    chunk_number: chunkNumber,
                                    file
                                });
                            }
                            chunkUtils.writeFileChunk(addressKeyIdentifier, transactionId, file.name, body).then(() => {
                                callback();
                            }).catch((err) => {
                                return callback({
                                    error       : err,
                                    chunk_number: chunkNumber,
                                    file
                                });
                            });
                        });
                    }, (err) => {
                        if (err) {
                            return reject(err);
                        }
                        return resolve();
                    });
                }));

                Promise.all(promisesToDownloadFileByChunks)
                       .then(() => {
                           const url = serverEndpoint.concat('/ack/')
                                                     .concat(self.nodeId).concat('/')
                                                     .concat(transactionId).concat('/');
                           request.post(url, {}, (err, response, body) => {
                               unlock();
                               if (err) {
                                   console.log('[file-receiver] error, ', err);
                                   return reject();
                               }
                               resolve();
                           });
                       })
                       .catch(err => {
                           unlock();
                           reject(err);
                       });
            });
        });
    }


}


export default new Receiver();
