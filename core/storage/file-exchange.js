import path from 'path';
import os from 'os';
import fs from 'fs';
import config from '../config/config';
import sender from './sender';
import receiver from './receiver';
import fileManager from './file-manager';
import _ from 'lodash';
import async from 'async';
import peer from '../../net/peer';
import network from '../../net/network';
import eventBus from '../event-bus';


class FileExchange {
    constructor() {
        this.activeTransactionSync = new Set();
    }

    initialize() {
        this.filesRootFolder = path.join(os.homedir(), config.STORAGE_CONNECTION.FOLDER);
        if (!fs.existsSync(this.filesRootFolder)) {
            fs.mkdirSync(path.join(this.filesRootFolder));
        }
        return sender.initialize()
                     .then(() => receiver.initialize())
                     .then(() => {
                         this._registerEventListeners();
                     });
    }

    _onTransactionFileSyncRequest(data, ws) {
        const {
                  address_key_identifier: addressKeyIdentifier,
                  transaction_id        : transactionID,
                  transaction_file_list : transactionFileList
              }                 = data;
        const fileAvailableList = [];
        async.eachSeries(transactionFileList, (fileHash, callback) => {
            fileManager.hasFile(addressKeyIdentifier, transactionID, fileHash)
                       .then(exists => {
                           if (exists) {
                               return sender.getNumberOfChunks(addressKeyIdentifier, transactionID, fileHash)
                                            .then(totalChunks => {
                                                fileAvailableList.push({
                                                    name       : fileHash,
                                                    chunk_count: totalChunks
                                                });
                                                callback();
                                            }).catch(() => callback());
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

            if (network.nodeIsPublic) {
                const server            = sender.newSenderInstance();
                data['server_endpoint'] = `https://${network.nodePublicIp}:${server.address().port}/`;
                const filesToRemove     = [];

                async.eachSeries(fileAvailableList, (file, callback) => { // serve files via https server
                    sender.serveFile(ws.nodeID, addressKeyIdentifier, transactionID, file.file_hash)
                          .then(() => callback())
                          .catch(() => {
                              filesToRemove.push(file);
                              callback();
                          });
                }, () => {
                    _.pull(fileAvailableList, filesToRemove);
                    return peer.transactionFileSyncResponse(data, ws);
                });
            }
            else {
                return peer.transactionFileSyncResponse(data, ws); /* node not public:  no server  endpoint */
            }
        });

    }

    _onTransactionFileChunkRequest(data) {
        return sender.sendChunk(data.receiver_endpoint, data.address_key_identifier, data.transaction_id, data.file_hash, data.chunk_number);
    }

    _registerEventListeners() {
        // message exchange protocol here
        eventBus.on('transaction_file_chunk_request', this._onTransactionFileChunkRequest.bind(this));
        eventBus.on('transaction_file_request', this._onTransactionFileSyncRequest.bind(this));
    }

    syncFilesFromTransaction(transaction) {
        const transactionId        = transaction.transaction_id,
              addressKeyIdentifier = transaction.transaction_input_list[0].address_key_identifier,
              fileList             = transaction.transaction_output_attribute.transaction_output_metadata.files;

        if (!transactionId || !addressKeyIdentifier || !fileList ||
            this.activeTransactionSync.has(transactionId)) {
            return;
        }

        this.activeTransactionSync.add(transactionId);

        const fileListToRequest = [];
        async.eachSeries(fileList, (file, callback) => {
            fileManager.hasFile(addressKeyIdentifier, transactionId, file.name)
                       .then(hasFile => {
                           if (hasFile) {
                               return callback();
                           }
                           fileListToRequest.push(file);
                           callback();
                       });
        }, () => {
            if (fileListToRequest.length > 0) {
                let nodesWS = _.shuffle(network.registeredClients);
                async.eachSeries(nodesWS, (ws, callback) => {
                    peer.transactionFileSyncRequest(addressKeyIdentifier, transactionId, fileListToRequest, ws)
                        .then((data) => {
                            let serverEndpoint = data.server_endpoint;
                            if (serverEndpoint) {
                                receiver.downloadFileList(serverEndpoint, data.transaction_file_list)
                                        .then(() => callback(true))
                                        .catch(({files_downloaded: filesDownloaded}) => {
                                            if (filesDownloaded.length > 0) {
                                                _.remove(fileListToRequest, file => filesDownloaded.has(file.name));
                                            }

                                            if (fileListToRequest.length === 0) { // no more files to request
                                                return callback(true);
                                            }

                                            callback();
                                        });
                            }
                            else {
                                if (!network.nodeIsPublic) {
                                    return callback();
                                }

                                receiver.requestFileListUpload(serverEndpoint, addressKeyIdentifier, transactionId, data.transaction_file_list, ws)
                                        .then(() => callback(true))
                                        .catch(({files_received: filesReceived}) => {
                                            if (filesReceived.length > 0) {
                                                _.remove(fileListToRequest, file => filesReceived.has(file.name));
                                            }

                                            if (fileListToRequest.length === 0) { //no more files to request
                                                return callback(true);
                                            }

                                            callback();
                                        });
                            }
                        }).catch(() => callback());
                }, () => {
                    this.activeTransactionSync.delete(transactionId);
                });
            }
            else {
                this.activeTransactionSync.delete(transactionId);
            }
        });
    }

}


export default new FileExchange();
