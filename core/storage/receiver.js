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
import peer from '../../net/peer';
import config from '../config/config';
import sender from './sender';


class Receiver {
    constructor() {
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
                              const serverOptions = {
                                  key      : certificatePrivateKeyPem,
                                  cert     : certificatePem,
                                  ecdhCurve: 'prime256v1'
                              };
                              this.nodeId         = network.nodeID;
                              this._defineServerOperations();
                              return this._startReceiverServer(serverOptions);
                          }).then(() => queue.initializeReceiver());
    }

    _startReceiverServer(serverOptions) {
        return new Promise((resolve, reject) => {
            this.httpsServer = https.createServer(serverOptions, this.app);
            this.httpsServer.listen(config.NODE_PORT_STORAGE_RECEIVER, config.NODE_BIND_IP, (err) => {
                if (err) {
                    console.log('[file-sender] error ', err);
                    return reject(err);
                }
                console.log('[file-receiver] Server listening on port ' + config.NODE_PORT_STORAGE_RECEIVER);
                resolve();
            });
        });
    }

    releaseReceiverInstance() {
        queue.decrementServerInstancesInReceiver();
        if (!queue.isReceiverServerActive()) {
            this.httpsServer._server && this.httpsServer._server.close();
            this.httpsServer.close();
            this.httpsServer = undefined;
        }
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
            let chunkNumber          = parseInt(req.params.chunkNumber);

            if (queue.hasChunkToReceive(nodeId, transactionId, fileHash, chunkNumber)) {
                const buffers = [];
                req.on('data', function(chunk) {
                    buffers.push(chunk);
                });

                req.on('end', () => {
                    const chunk = Buffer.concat(buffers);
                    chunkUtils.writeFileChunk(addressKeyIdentifier, transactionId, fileHash, chunk)
                              .then(() => {
                                  queue.removeChunkFromReceiver(nodeId, transactionId, fileHash, chunkNumber).then(_ => _);
                                  eventBus.emit(`transaction_file_chunk_response:${nodeId}:${transactionId}:${fileHash}`, req.params);
                                  res.send('ok');
                              });
                });
            }
            else {
                res.writeHead(403);
                res.end('Requested file is not in queue to be send!');
            }
        });
    }

    registerFileChunkForUpload(nodeId, transactionId, fileHash, numberOfChunks, requestedChunk) {
        return queue.addChunkToReceiver(nodeId, transactionId, fileHash, numberOfChunks, requestedChunk);
    }

    unregisterFileChunkUpload(nodeId, transactionId, fileHash, requestedChunk) {
        return queue.removeChunkFromReceiver(nodeId, transactionId, fileHash, requestedChunk);
    }

    downloadFileList(serverEndpoint, addressKeyIdentifier, transactionId, fileList) {
        return new Promise((resolve, reject) => {
            const filesDownloaded = new Set();
            mutex.lock(['file-downloader'], unlock => {
                const promisesToDownloadFileByChunks = fileList.map(file => new Promise((resolve, reject) => {
                    async.times(file.chunk_count, (chunkNumber, callback) => {
                        const url = serverEndpoint.concat('/file/')
                                                  .concat(this.nodeId).concat('/')
                                                  .concat(addressKeyIdentifier).concat('/')
                                                  .concat(transactionId).concat('/')
                                                  .concat(file.file_hash).concat('/')
                                                  .concat(chunkNumber);
                        request.get(url, {
                            strictSSL: false,
                            encoding : null
                        }, (err, response, body) => {
                            if (err) {
                                console.log('[file-receiver] error, ', err);
                                return callback({
                                    error       : err,
                                    chunk_number: chunkNumber,
                                    file
                                });
                            }
                            chunkUtils.writeFileChunk(addressKeyIdentifier, transactionId, file.file_hash, body).then(() => {
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
                            return reject({
                                ...err,
                                files_received: filesDownloaded
                            });
                        }

                        filesDownloaded.add(file.file_hash);
                        return resolve();
                    });
                }));

                Promise.all(promisesToDownloadFileByChunks)
                       .then(() => {
                           const url = serverEndpoint.concat('/ack/')
                                                     .concat(network.nodeID).concat('/')
                                                     .concat(transactionId).concat('/');
                           request.post(url, {
                               strictSSL: false
                           }, (err, response, body) => {
                               unlock();
                               if (err) {
                                   console.log('[file-receiver] error, ', err);
                                   return reject({
                                       error         : 'ack_error',
                                       files_received: filesDownloaded
                                   });
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

    requestFileListUpload(addressKeyIdentifier, transactionId, fileList, ws) {
        const serverEndpoint = `https://${network.nodePublicIp}:${config.NODE_PORT_STORAGE_RECEIVER}`;
        return new Promise((resolve, reject) => {
            const filesReceived = new Set();
            mutex.lock(['file-receiver'], unlock => {
                const promisesToReceiveFileByChunks = fileList.map(file => new Promise((resolve, reject) => {
                    async.times(file.chunk_count, (chunkNumber, callback) => {
                        this.registerFileChunkForUpload(ws.nodeID, transactionId, file.file_hash, file.chunk_count, chunkNumber)
                            .then(() => peer.transactionFileChunkRequest(serverEndpoint, addressKeyIdentifier, transactionId, file.file_hash, chunkNumber, ws))
                            .then(() => {
                                let timeoutHandlerID;
                                let isTimeout = false;
                                eventBus.once(`transaction_file_chunk_response:${ws.nodeID}:${transactionId}:${file.file_hash}`, () => {
                                    if (isTimeout) {
                                        return;
                                    }
                                    clearTimeout(timeoutHandlerID);
                                    this.unregisterFileChunkUpload(ws.nodeID, transactionId, file.file_hash, chunkNumber).then(_ => _);
                                    callback();
                                });
                                timeoutHandlerID = setTimeout(() => {
                                    isTimeout = true;
                                    eventBus.removeAllListeners(`transaction_file_chunk_response:${ws.nodeID}:${transactionId}:${file.file_hash}`);
                                    return callback({
                                        error       : 'chunk_request_timeout',
                                        chunk_number: chunkNumber,
                                        file
                                    });
                                }, config.NETWORK_LONG_TIME_WAIT_MAX * 20);
                            })
                            .catch(err => {
                                return callback({
                                    error       : err,
                                    chunk_number: chunkNumber,
                                    file
                                });
                            });
                    }, (err) => {
                        if (err) {
                            return reject({
                                ...err,
                                files_received: filesReceived
                            });
                        }
                        filesReceived.add(file.file_hash);
                        return resolve();
                    });
                }));

                Promise.all(promisesToReceiveFileByChunks)
                       .then(() => {
                           unlock();
                           resolve();
                       })
                       .catch(err => {
                           unlock();
                           reject(err);
                       });
            });
        }).then(() => {
            this.releaseReceiverInstance();
        }).catch(err => {
            this.releaseReceiverInstance();
            return Promise.reject(err);
        });
    }

}


export default new Receiver();
