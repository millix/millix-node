import path from 'path';
import os from 'os';
import fs from 'fs';
import config from '../config/config';
import sender from './sender';
import receiver from './receiver';
import fileManager from './file-manager';
import fileSync from './file-sync';
import _ from 'lodash';
import async from 'async';
import peer from '../../net/peer';
import network from '../../net/network';
import eventBus from '../event-bus';
import storageAcl from './storage-acl';


class FileExchange {
    constructor() {
        this.activeTransactionSync = new Set();
    }

    initialize() {
        if (!config.MODE_STORAGE_SYNC) {
            return Promise.resolve();
        }

        this.filesRootFolder = config.STORAGE_CONNECTION.FOLDER;
        if (!fs.existsSync(this.filesRootFolder)) {
            fs.mkdirSync(path.join(this.filesRootFolder));
        }
        return sender.initialize()
                     .then(() => receiver.initialize())
                     .then(() => fileSync.initialize())
                     .then(() => {
                         this._registerEventListeners();
                     });
    }

    _onTransactionFileSyncRequest(data, ws) {
        const {
                  address_key_identifier: addressKeyIdentifier,
                  transaction_id        : transactionID,
                  transaction_date      : transactionDate,
                  transaction_file_list : transactionFileList
              } = data;

        // if the node is receiving the file it is not yet available to serve it
        if (this.activeTransactionSync.has(transactionID)) {
            return peer.transactionFileSyncResponse(transactionID, {transaction_file_not_found: true}, ws);
        }

        const fileAvailableList = [];
        async.eachSeries(transactionFileList, (fileHash, callback) => {
            fileManager.hasFile(addressKeyIdentifier, transactionDate, transactionID, fileHash)
                       .then(exists => {
                           if (exists) {
                               return fileManager.checkFile(addressKeyIdentifier, transactionDate, transactionID, fileHash)
                                                 .catch(() => false)
                                                 .then(isValid => {
                                                     if (!isValid) {
                                                         const transactionFolder = fileManager.createAndGetFolderLocation(addressKeyIdentifier, transactionDate, transactionID);
                                                         fileManager.readTransactionAttributeJSONFile(transactionFolder)
                                                                    .then((transactionOutputAttribute) => {
                                                                        return fileManager.removeDirectory(transactionFolder).then(() => {
                                                                            fileSync.pushToQueue({
                                                                                transaction_id             : transactionID,
                                                                                address_key_identifier     : addressKeyIdentifier,
                                                                                transaction_output_metadata: transactionOutputAttribute,
                                                                                transaction_date           : transactionDate,
                                                                                timestamp                  : Date.now()
                                                                            });
                                                                        });
                                                                    })
                                                                    .catch(_ => _)
                                                                    .then(() => callback());
                                                         return;
                                                     }

                                                     return sender.getNumberOfChunks(addressKeyIdentifier, transactionDate, transactionID, fileHash)
                                                                  .then(totalChunks => {
                                                                      fileAvailableList.push({
                                                                          file_hash  : fileHash,
                                                                          chunk_count: totalChunks
                                                                      });
                                                                      callback();
                                                                  }).catch(() => callback());
                                                 });
                           }
                           callback();
                       });
        }, () => {
            if (fileAvailableList.length === 0) {
                return peer.transactionFileSyncResponse(transactionID, {transaction_file_not_found: true}, ws);
            }

            const data = {
                transaction_id        : transactionID,
                address_key_identifier: addressKeyIdentifier,
                transaction_file_list : fileAvailableList
            };

            if (sender.isPublic && _.sample([
                false,
                true
            ])) { // randomly switch between upload and download mode
                data['server_endpoint'] = `https://${network.nodePublicIp}:${config.NODE_PORT_STORAGE_PROVIDER}`;
                _.each(fileAvailableList, (file) => { // serve files via https server
                    sender.serveFile(ws.nodeID, addressKeyIdentifier, transactionID, file.file_hash);
                });
            }

            return peer.transactionFileSyncResponse(data, ws);
        });

    }

    _onTransactionFileChunkRequest(data) {
        return sender.sendChunk(data.receiver_endpoint, data.address_key_identifier, data.transaction_date, data.transaction_id, data.file_hash, data.chunk_number);
    }

    _registerEventListeners() {
        // message exchange protocol here
        eventBus.on('transaction_file_chunk_request', this._onTransactionFileChunkRequest.bind(this));
        eventBus.on('transaction_file_request', this._onTransactionFileSyncRequest.bind(this));
    }

    addTransactionToSyncQueue(transaction) {
        fileSync.add(transaction);
    }

    syncFilesFromTransaction(transactionId, addressKeyIdentifier, transactionOutputAttribute, transactionDate) {
        return new Promise((resolve, reject) => {
            const fileList = transactionOutputAttribute?.file_list;
            if (!transactionId || !transactionDate || !addressKeyIdentifier || !transactionOutputAttribute || !fileList) {
                return reject('transaction_file_sync_invalid');
            }
            else if (this.activeTransactionSync.has(transactionId)) {
                return resolve('transaction_file_sync_in_progress');
            }
            this.activeTransactionSync.add(transactionId);

            const fileListToRequest = [];
            async.eachSeries(fileList, (file, callback) => {
                fileManager.hasFile(addressKeyIdentifier, transactionDate, transactionId, file.hash)
                           .then(hasFile => {
                               if (hasFile) {
                                   return callback();
                               }
                               fileListToRequest.push(file);
                               callback();
                           });
            }, () => {
                if (fileListToRequest.length > 0) {
                    let nodesWS = _.shuffle(_.filter(network.registeredClients, ws => ws.featureSet.has('storage')));
                    async.eachSeries(nodesWS, (ws, callback) => {
                        peer.transactionFileSyncRequest(addressKeyIdentifier, transactionDate, transactionId, fileListToRequest.map(file => file.hash), ws)
                            .then((data) => {
                                let serverEndpoint = data.server_endpoint;
                                if (serverEndpoint) {
                                    receiver.downloadFileList(serverEndpoint, addressKeyIdentifier, transactionDate, transactionId, data.transaction_file_list)
                                            .then(() => {
                                                _.pull(fileListToRequest, ...fileListToRequest); // empty list
                                                callback(true);
                                            })
                                            .catch(({files_received: filesDownloaded}) => {
                                                if (filesDownloaded.size > 0) {
                                                    _.remove(fileListToRequest, file => filesDownloaded.has(file.name));
                                                }

                                                if (fileListToRequest.length === 0) { // no more files to request
                                                    return callback(true);
                                                }

                                                callback();
                                            });
                                }
                                else {
                                    if (!receiver.isPublic) {
                                        return callback();
                                    }

                                    receiver.requestFileListUpload(addressKeyIdentifier, transactionDate, transactionId, data.transaction_file_list, ws)
                                            .then(() => {
                                                _.pull(fileListToRequest, ...fileListToRequest); // empty list
                                                storageAcl.removeFileFromReceiver(ws.nodeID, transactionId);
                                                callback(true);
                                            })
                                            .catch(({files_received: filesDownloaded}) => {
                                                if (filesDownloaded.size > 0) {
                                                    _.remove(fileListToRequest, file => filesDownloaded.has(file.name));
                                                }

                                                if (fileListToRequest.length === 0) { // no more files to request
                                                    return callback(true);
                                                }

                                                callback();
                                            });
                                }
                            }).catch(() => callback());
                    }, () => {
                        this.activeTransactionSync.delete(transactionId);
                        if (fileListToRequest.length === 0) {
                            const metadataFilePath = fileManager.createAndGetFolderLocation(addressKeyIdentifier, transactionDate, transactionId);
                            fileManager.writeTransactionAttributeJSONFile(transactionOutputAttribute, metadataFilePath).then(_ => _);
                        }
                    });
                    resolve('transaction_file_sync_started');
                }
                else {
                    this.activeTransactionSync.delete(transactionId);
                    resolve('transaction_file_sync_completed');
                }
            });
        });
    }

    close() {
        fileSync.close().then(_ => _);
        sender.stop();
        receiver.stop();
    }

}


export default new FileExchange();
