import path from 'path';
import os from 'os';
import fs from 'fs';
import mutex from '../mutex';
import console from '../console';
import config from '../config/config';
import async from 'async';


class Queue {
    constructor() {
        this.filesPendingToSend         = path.join(os.homedir(), config.FILES_CONNECTION.PENDING_TO_SEND);
        this.listOfPendingFilesInSender = [];
        this.countActiveSenderServers   = 0;

        this.filesPendingToReceive        = path.join(os.homedir(), config.FILES_CONNECTION.PENDING_TO_RECEIVE);
        this.listOfPendingFilesInReceiver = [];
        this.countActiveReceiverServers   = 0;
    }

    initializeSender() {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(this.filesPendingToSend)) {
                fs.closeSync(fs.openSync(this.filesPendingToSend, 'w'));
            }
            this.listOfPendingFilesInSender = this._loadPendingFiles(this.filesPendingToSend);
            resolve();
        });
    }

    initializeReceiver() {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(this.filesPendingToReceive)) {
                fs.closeSync(fs.openSync(this.filesPendingToReceive, 'w'));
            }
            this.listOfPendingFilesInReceiver = this._loadPendingFiles(this.filesPendingToReceive);
            resolve();
        });
    }

    _buildEntry(nodeId, transactionId, fileHash, nodePublicKey) {
        return nodeId + ';' + transactionId + ';' + fileHash + ';' + nodePublicKey + '\n';
    }

    _writeInFile(data, fileLocation) {
        return new Promise((resolve, reject) => {
            fs.writeFile(fileLocation, '', (err) => {
                if (err) {
                    console.log('[file-queue] error, ', err);
                    return reject();
                }
                async.forEachOf(data, (entry, index, next) => {
                    let line = this._buildEntry(entry.nodeId, entry.transactionId, entry.fileHash, entry.nodePublicKey);
                    fs.appendFile(fileLocation, line, (err) => {
                        if (err) {
                            console.log('[file-queue] error, ', err);
                            return reject();
                        }
                        next();
                    });
                }, () => resolve());
            });
        });
    }

    _loadPendingFiles(fileLocation) {
        let listOfPendingFiles = [];
        mutex.lock(['update_pending_files'], (unlock) => {
            let content = fs.readFile(fileLocation);
            content.split(/\r?\n/).forEach(line => {
                let elements = line.split(';');
                listOfPendingFiles.append({
                    nodeId       : elements[0],
                    transactionId: elements[1],
                    fileHash     : elements[2],
                    nodePublicKey: elements[3]
                });
            });
            unlock();
        });
        return listOfPendingFiles;
    }

    /***********************
     * Sender methods
     ***********************/
    incrementServerInstancesInSender() {
        this.countActiveSenderServers += 1;
    }

    decrementServerInstancesInSender() {
        if (this.countActiveSenderServers > 0) {
            this.countActiveSenderServers -= 1;
        }
    }

    anyActiveSenderServer() {
        return this.countActiveSenderServers !== 0;
    }

    getListOfPendingFilesInSender() {
        return this.listOfPendingFilesInSender;
    }

    addNewFileInSender(nodeId, transactionId, fileHash, nodePublicKey) {
        let newEntry = this._buildEntry(nodeId, transactionId, fileHash, nodePublicKey);
        mutex.lock(['update_pending_files'], (unlock) => {
            fs.appendFile(this.filesPendingToSend, newEntry, (err) => {
                if (err) {
                    console.log('[file-queue] error, ', err);
                }
                else {
                    this.listOfPendingFilesInSender.append({
                        nodeId       : nodeId,
                        transactionId: transactionId,
                        fileHash     : fileHash,
                        nodePublicKey: nodePublicKey
                    });
                }
                unlock();
            });
        });
    }

    removeEntryFromSender(nodeId, transactionId) {
        mutex.lock(['update_pending_files'], (unlock) => {
            this.listOfPendingFilesInSender = this.listOfPendingFilesInSender.filter(function(value, index, arr) {
                return nodeId !== value.nodeId && transactionId !== value.transactionId;
            });
            this._writeInFile(this.listOfPendingFilesInSender, this.filesPendingToSend).then(() => {
                unlock();
            });
        });
    }

    hasFileToSend(nodeId, transactionId, fileHash) {
        return (this.listOfPendingFilesInSender.filter((value, index, arr) => {
            return nodeId === value.nodeId && transactionId === value.transactionId && fileHash === value.fileHash;
        }).length > 0);
    }

    hasTransactionRequest(nodeId, transactionId) {
        return (this.listOfPendingFilesInSender.filter((value, index, arr) => {
            return nodeId === value.nodeId && transactionId === value.transactionId;
        }).length > 0);
    }

    /***********************
     * Receiver methods
     ***********************/
    incrementServerInstancesInReceiver() {
        this.countActiveReceiverServers += 1;
    }

    decrementServerInstancesInReceiver() {
        if (this.countActiveReceiverServers > 0) {
            this.countActiveReceiverServers -= 1;
        }
    }

    anyActiveReceiverServer() {
        return this.countActiveReceiverServers !== 0;
    }

    getListOfPendingFilesInReceiver() {
        return this.listOfPendingFilesInReceiver;
    }

    addNewFileInReceiver(nodeId, transactionId, fileHash, nodePublicKey) {
        let newEntry = this._buildEntry(nodeId, transactionId, fileHash, nodePublicKey);
        mutex.lock(['update_pending_files'], (unlock) => {
            fs.appendFile(this.filesPendingToReceive, newEntry, (err) => {
                if (err) {
                    console.log('[file-queue] error, ', err);
                }
                else {
                    this.listOfPendingFilesInReceiver.append({
                        nodeId       : nodeId,
                        transactionId: transactionId,
                        fileHash     : fileHash,
                        nodePublicKey: nodePublicKey
                    });
                }
                unlock();
            });
        });
    }

    removeEntryFromReceiver(nodeId, transactionId) {
        mutex.lock(['update_pending_files'], (unlock) => {
            this.listOfPendingFilesInReceiver = this.listOfPendingFilesInReceiver.filter(function(value, index, arr) {
                return nodeId !== value.nodeId && transactionId !== value.transactionId;
            });
            this._writeInFile(this.listOfPendingFilesInReceiver, this.filesPendingToReceive).then(() => {
                unlock();
            });
        });
    }

}


export default new Queue();
