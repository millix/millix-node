import WebSocket, {Server} from 'ws';
import path from 'path';
import os from 'os';
import fs from 'fs';
import config, {CHUNK_SIZE} from '../config/config';
import fileManager from './file-manager';

class Chunker {
    constructor() {
    }

    writeFile(addressKeyIdentifier, transactionId, fileHash, chunk){
        return new Promise((resolve, reject) => {
            let fileLocation = fileManager.createAndGetFileLocation(addressKeyIdentifier, transactionId, fileHash);
            fs.appendFile(fileLocation, chunk, (err) => {
                if (err) {
                    console.log(err);
                    return reject();
                }
                resolve();
            });
        })
    }

    getChunk(addressKeyIdentifier, transactionId, fileHash, position){
        return new Promise((resolve, reject)=>{
            let offset = position * CHUNK_SIZE;
            let buffer = new Buffer.alloc(CHUNK_SIZE);
            let fileLocation = fileManager.getFileLocation(addressKeyIdentifier, transactionId, fileHash);
            fs.open(fileLocation, 'r', (err, fd) => {
                if (err) {
                    return reject(err);
                }
                fs.read(fd, buffer, 0, CHUNK_SIZE, offset,  (err, bytes) => {
                    if (err) {
                        return reject(err);
                    }

                    fs.close(fd, (err) => {
                        if (err) {
                            return reject(err);
                        }

                        resolve(buffer);
                    });
                });
            });
        });
    }

    getChunkSize(addressKeyIdentifier, transactionId, fileHash){
        return new Promise((resolve,reject)=>{
            let fileLocation = fileManager.getFileLocation(addressKeyIdentifier, transactionId, fileHash);
            fs.stat(fileLocation,(err, stats) => {
                if (err) {
                    return reject(err);
                }
                resolve(stats.size / CHUNK_SIZE);
            })
        });
    }
}

export default new Chunker();
