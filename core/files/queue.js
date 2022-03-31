import path from 'path';
import os from 'os';
import fs from 'fs';
import mutex from '../mutex';
import console from '../console';
import config from '../config/config';
import async from 'async';


class Queue {
    static SENDER   = 'SENDER';
    static RECEIVER = 'RECEIVER';

    constructor() {
        this.senderLogFile             = path.join(os.homedir(), config.FILES_CONNECTION.PENDING_TO_SEND);
        this.senderLog                = [];
        this.countActiveSendInstances = 0;

        this.receiverFileLog             = path.join(os.homedir(), config.FILES_CONNECTION.PENDING_TO_RECEIVE);
        this.receiverLog                 = [];
        this.countActiveReceiveInstances = 0;
    }

    initializeSender() {
        if (!fs.existsSync(this.senderLogFile)) {
            fs.closeSync(fs.openSync(this.senderLogFile, 'w'));
        }
        return this._loadSenderLogFromFile(this.senderLogFile);
    }

    initializeReceiver() {
        if (!fs.existsSync(this.receiverFileLog)) {
            fs.closeSync(fs.openSync(this.receiverFileLog, 'w'));
        }
        return this._loadReceiverLogFromFile(this.receiverFileLog);
    }

    _buildEntry(entry, type) {
        if (type === Queue.SENDER) {
            return this._buildEntryForSender(entry);
        }
        else if (type === Queue.RECEIVER) {
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

    _writeInFile(data, fileLocation, type) {
        return new Promise((resolve, reject) => {
            fs.writeFile(fileLocation, '', (err) => {
                if (err) {
                    console.log('[file-queue] error, ', err);
                    return reject();
                }
                async.eachSeries(data, (entry, callback) => {
                    let line = this._buildEntry(entry, type);
                    fs.appendFile(fileLocation, line, (err) => {
                        if (err) {
                            console.log('[file-queue] error, ', err);
                            return callback(err);
                        }
                        callback();
                    });
                }, (err) => err ? reject(err) : resolve());
            });
        });
    }

    /***********************
     * Sender methods
     ***********************/
    incrementServerInstancesInSender() {
        this.countActiveSendInstances += 1;
    }

    decrementServerInstancesInSender() {
        if (this.countActiveSendInstances > 0) {
            this.countActiveSendInstances -= 1;
        }
    }

    isSenderServerActive() {
        return this.countActiveSendInstances > 0;
    }

    addNewFileInSender(nodeId, transactionId, fileHash, nodePublicKey) {
        return new Promise((resolve, reject) => {
            let newEntry = this._buildEntry({
                nodeId,
                transactionId,
                fileHash,
                nodePublicKey
            }, Queue.SENDER);
            mutex.lock(['update-sender-file-log'], (unlock) => {
                fs.appendFile(this.senderLogFile, newEntry, (err) => {
                    if (err) {
                        console.log('[file-queue] error, ', err);
                        unlock();
                        return reject(err);
                    }
                    else {
                        this.senderLog.append({
                            nodeId       : nodeId,
                            transactionId: transactionId,
                            fileHash     : fileHash,
                            nodePublicKey: nodePublicKey
                        });
                        unlock();
                        resolve();
                    }
                });
            });
        });
    }

    removeEntryFromSender(nodeId, transactionId) {
        return new Promise((resolve, reject) => {
            mutex.lock(['update-sender-file-log'], (unlock) => {
                this.senderLog = this.senderLog.filter(function(value, index, arr) {
                    return nodeId !== value.nodeId && transactionId !== value.transactionId;
                });
                this._writeInFile(this.senderLog, this.senderLogFile, Queue.SENDER).then(() => {
                    unlock();
                    resolve();
                }).catch(err => {
                    console.log('[file-queue] error', err);
                    unlock();
                    reject(err);
                });
            });
        });
    }

    hasFileToSend(nodeId, transactionId, fileHash) {
        return !!this.senderLog.find((value, index, arr) => {
            return nodeId === value.nodeId && transactionId === value.transactionId && fileHash === value.fileHash;
        });
    }

    hasTransactionRequest(nodeId, transactionId) {
        return !!this.senderLog.filter((value, index, arr) => {
            return nodeId === value.nodeId && transactionId === value.transactionId;
        });
    }

    _loadSenderLogFromFile(fileLocation) {
        return new Promise((resolve, reject) => {
            mutex.lock(['update-sender-file-log'], (unlock) => {
                fs.readFile(fileLocation, 'utf-8', (err, content) => {
                    if (err) {
                        console.log('[file-queue] error', err);
                        unlock();
                        return reject(err);

                    }

                    content.split(/\r?\n/).forEach(line => {
                        let elements = line.split(';');
                        this.senderLog.append({
                            nodeId       : elements[0],
                            transactionId: elements[1],
                            fileHash     : elements[2],
                            nodePublicKey: elements[3]
                        });
                    });

                    unlock();
                    resolve();
                });
            });
        });
    }

    /***********************
     * Receiver methods
     ***********************/
    incrementServerInstancesInReceiver() {
        this.countActiveReceiveInstances += 1;
    }

    decrementServerInstancesInReceiver() {
        if (this.countActiveReceiveInstances > 0) {
            this.countActiveReceiveInstances -= 1;
        }
    }

    isReceiverServerActive() {
        return this.countActiveReceiveInstances > 0;
    }

    addNewChunkInReceiver(nodeId, transactionId, fileHash, nodePublicKey, numberOfChunks, requestedChunk) {
        return new Promise((resolve, reject) => {
            const newEntry = this._buildEntry({
                nodeId,
                transactionId,
                fileHash,
                nodePublicKey,
                numberOfChunks,
                requestedChunk
            }, Queue.RECEIVER);
            mutex.lock(['update-receiver-file-log'], (unlock) => {
                fs.appendFile(this.receiverFileLog, newEntry, (err) => {
                    if (err) {
                        console.log('[file-queue] error, ', err);
                        unlock();
                        return reject(err);
                    }

                    this.receiverLog.append({
                        nodeId        : nodeId,
                        transactionId : transactionId,
                        fileHash      : fileHash,
                        nodePublicKey : nodePublicKey,
                        numberOfChunks: numberOfChunks,
                        requestedChunk: requestedChunk
                    });
                    unlock();
                    resolve();
                });
            });
        });
    }

    removeEntryFromReceiver(nodeId, transactionId, fileHash, requestedChunk) {
        return new Promise((resolve, reject) => {
            mutex.lock(['update-receiver-file-log'], (unlock) => {
                this.receiverLog = this.receiverLog.filter(function(value, index, arr) {
                    return nodeId !== value.nodeId && transactionId !== value.transactionId && transactionId !== value.fileHash && requestedChunk !== value.requestedChunk;
                });
                this._writeInFile(this.receiverLog, this.receiverFileLog, Queue.RECEIVER).then(() => {
                    unlock();
                    resolve();
                }).catch(err => {
                    console.log('[file-queue] error', err);
                    unlock();
                    reject(err);
                });
            });
        });
    }

    hasChunkToReceive(nodeId, transactionId, fileHash, requestedChunk) {
        return !!this.receiverLog.find((value, index, arr) => {
            return nodeId === value.nodeId && transactionId === value.transactionId && fileHash === value.fileHash && requestedChunk === value.requestedChunk;
        });
    }

    isLastChunk(nodeId, transactionId, fileHash, requestedChunk) {
        let data = this.receiverLog.find((value, index, arr) => {
            return nodeId === value.nodeId && transactionId === value.transactionId && fileHash === value.fileHash && requestedChunk === value.requestedChunk;
        });
        return data.numberOfChunks === requestedChunk;
    }

    _loadReceiverLogFromFile(fileLocation) {
        return new Promise((resolve, reject) => {
            mutex.lock(['update-receiver-file-log'], (unlock) => {
                fs.readFile(fileLocation, 'utf-8', (err, content) => {
                    if (err) {
                        console.log('[file-queue] error', err);
                        unlock();
                        return reject(err);

                    }

                    content.split(/\r?\n/).forEach(line => {
                        let elements = line.split(';');
                        this.receiverLog.append({
                            nodeId        : elements[0],
                            transactionId : elements[1],
                            fileHash      : elements[2],
                            nodePublicKey : elements[3],
                            numberOfChunks: elements[4],
                            requestedChunk: elements[5]
                        });
                    });
                    unlock();
                    resolve();
                });
            });
        });
    }
}


export default new Queue();
