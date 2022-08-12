import fs from 'fs';
import {CHUNK_SIZE} from '../config/config';
import fileManager from './file-manager';


class ChunkUtils {
    constructor() {
    }

    writeFileChunk(addressKeyIdentifier, transactionDate, transactionId, fileHash, chunk, chunkNumber) {
        return new Promise((resolve, reject) => {
            let fileLocation = fileManager.createAndGetFileLocation(addressKeyIdentifier, transactionDate, transactionId, fileHash);
            fs.open(fileLocation, 'w', (err, fd) => {
                if (err) {
                    console.log("[chunk-utils] error: ", err);
                    return reject(err);
                }

                fs.write(fd, chunk, 0, chunk.length, chunkNumber * CHUNK_SIZE, (err) => {
                    if (err) {
                        console.log("[chunk-utils] error: ", err);
                        return reject();
                    }
                    resolve();
                });
            });
        });
    }

    getChunk(addressKeyIdentifier, transactionDate, transactionId, fileHash, position) {
        return new Promise((resolve, reject) => {
            let offset       = position * CHUNK_SIZE;
            let buffer       = new Buffer.alloc(CHUNK_SIZE);
            let fileLocation = fileManager.getFileLocation(addressKeyIdentifier, transactionDate, transactionId, fileHash);
            fs.open(fileLocation, 'r', (err, fd) => {
                if (err) {
                    return reject(err);
                }
                fs.read(fd, buffer, 0, CHUNK_SIZE, offset, (err, bytes) => {
                    if (err) {
                        return reject(err);
                    }

                    fs.close(fd, (err) => {
                        if (err) {
                            return reject(err);
                        }

                        resolve(buffer.slice(0, bytes));
                    });
                });
            });
        });
    }

    getNumberOfChunks(addressKeyIdentifier, transactionDate, transactionId, fileHash) {
        return new Promise((resolve, reject) => {
            let fileLocation = fileManager.getFileLocation(addressKeyIdentifier, transactionDate, transactionId, fileHash);
            fs.stat(fileLocation, (err, stats) => {
                if (err) {
                    return reject(err);
                }
                resolve(Math.ceil(stats.size / CHUNK_SIZE));
            });
        });
    }
}


export default new ChunkUtils();
