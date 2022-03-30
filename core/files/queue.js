import path from 'path';
import os from 'os';
import fs from 'fs';
import mutex from '../mutex';
import console from '../console';
import config from '../config/config';
import async from 'async';

const SENDER   = 'sender';
const RECEIVER = 'receiver';


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
            this._loadPendingFilesFromSender(this.filesPendingToSend);
            resolve();
        });
    }

    initializeReceiver() {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(this.filesPendingToReceive)) {
                fs.closeSync(fs.openSync(this.filesPendingToReceive, 'w'));
            }
            this._loadPendingFilesFromReceiver(this.filesPendingToReceive);
            resolve();
        });
    }

    _buildEntry(entry, side) {
        if (side === SENDER) {
            return this._buildEntryForSender(entry);
        }
        else if (side === RECEIVER) {
            return this._buildEntryForReceiver(entry);
        }
    }

    _buildEntryForSender(entry) {
        return entry.nodeId + ';' +
               entry.transactionId + ';' +
               entry.fileHash + ';' +
               entry.nodePublicKey + '\n';
    }

    _buildEntryForReceiver(entry) {
        return entry.nodeId + ';' +
               entry.transactionId + ';' +
               entry.fileHash + ';' +
               entry.nodePublicKey + ';' +
               entry.numberOfChunks + ';' +
               entry.requestedChunk + '\n';
    }

    _writeInFile(data, fileLocation, side) {
        return new Promise((resolve, reject) => {
            fs.writeFile(fileLocation, '', (err) => {
                if (err) {
                    console.log('[file-queue] error, ', err);
                    return reject();
                }
                async.forEachOf(data, (entry, index, next) => {
                    let line = this._buildEntry(entry, side);
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
            this._writeInFile(this.listOfPendingFilesInSender, this.filesPendingToSend, SENDER).then(() => {
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

    _loadPendingFilesFromSender(fileLocation) {
        mutex.lock(['update_pending_files'], (unlock) => {
            let content = fs.readFile(fileLocation);
            content.split(/\r?\n/).forEach(line => {
                let elements = line.split(';');
                this.listOfPendingFilesInSender.append({
                    nodeId       : elements[0],
                    transactionId: elements[1],
                    fileHash     : elements[2],
                    nodePublicKey: elements[3]
                });
            });
            unlock();
        });
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

    addNewChunkInReceiver(nodeId, transactionId, fileHash, nodePublicKey, numberOfChunks, chunkNumber) {
        let newEntry = this._buildEntry(nodeId, transactionId, fileHash, nodePublicKey);
        mutex.lock(['update_pending_files'], (unlock) => {
            fs.appendFile(this.filesPendingToReceive, newEntry, (err) => {
                if (err) {
                    console.log('[file-queue] error, ', err);
                }
                else {
                    this.listOfPendingFilesInReceiver.append({
                        nodeId        : nodeId,
                        transactionId : transactionId,
                        fileHash      : fileHash,
                        nodePublicKey : nodePublicKey,
                        numberOfChunks: numberOfChunks,
                        chunkNumber   : chunkNumber
                    });
                }
                unlock();
            });
        });
    }

    removeEntryFromReceiver(nodeId, transactionId, fileHash, chunkNumber) {
        mutex.lock(['update_pending_files'], (unlock) => {
            this.listOfPendingFilesInReceiver = this.listOfPendingFilesInReceiver.filter(function(value, index, arr) {
                return nodeId !== value.nodeId && transactionId !== value.transactionId && transactionId !== value.fileHash && chunkNumber !== value.chunkNumber;
            });
            this._writeInFile(this.listOfPendingFilesInReceiver, this.filesPendingToReceive, RECEIVER).then(() => {
                unlock();
            });
        });
    }

    hasChunkToReceive(nodeId, transactionId, fileHash, chunkNumber) {
        return (this.listOfPendingFilesInReceiver.filter((value, index, arr) => {
            return nodeId === value.nodeId && transactionId === value.transactionId && fileHash === value.fileHash && chunkNumber === value.chunkNumber;
        }).length > 0);
    }

    isLastChunk(nodeId, transactionId, fileHash, chunkNumber) {
        let file = this.listOfPendingFilesInReceiver.filter((value, index, arr) => {
            return nodeId === value.nodeId && transactionId === value.transactionId && fileHash === value.fileHash && chunkNumber === value.chunkNumber;
        });
        return file[0].numberOfChunks === chunkNumber;
    }

    hasMoreFilesToReceiveFromServer(nodeId, transactionId){
        let file = this.listOfPendingFilesInReceiver.filter((value, index, arr) => {
            return nodeId === value.nodeId && transactionId === value.transactionId;
        });
        return file[0].numberOfChunks === chunkNumber;
    }

    _loadPendingFilesFromReceiver(fileLocation) {
        mutex.lock(['update_pending_files'], (unlock) => {
            let content = fs.readFile(fileLocation);
            content.split(/\r?\n/).forEach(line => {
                let elements = line.split(';');
                this.listOfPendingFilesInReceiver.append({
                    nodeId        : elements[0],
                    transactionId : elements[1],
                    fileHash      : elements[2],
                    nodePublicKey : elements[3],
                    numberOfChunks: elements[4],
                    requestedChunk: elements[5]
                });
            });
            unlock();
        });
    }
}


export default new Queue();
