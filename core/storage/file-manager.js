import path from 'path';
import os from 'os';
import config from '../config/config';
import fs from 'fs';
import crypto from 'crypto';
import wallet from '../wallet/wallet';
import mutex from '../mutex';
import {decrypt, encrypt} from 'eciesjs';
import walletUtils from '../wallet/wallet-utils';


class FileManager {
    static ENCRYPT = 'ENCRYPT';
    static DECRYPT = 'DECRYPT';

    constructor() {
        this.filesRootFolder = path.join(os.homedir(), config.STORAGE_CONNECTION.FOLDER);
    }

    getFileLocation(addressKeyIdentifier, transactionId, fileHash) {
        return path.join(this.filesRootFolder, addressKeyIdentifier, transactionId, fileHash);
    }

    hasFile(addressKeyIdentifier, transactionId, fileHash) {
        return new Promise((resolve) => {
            const filePath = this.getFileLocation(addressKeyIdentifier, transactionId, fileHash);
            fs.exists(filePath, (exists) => {
                return resolve(exists);
            });
        });
    }


    createAndGetFileLocation(addressKeyIdentifier, transactionId, fileHash) {
        let location = path.join(this.filesRootFolder, addressKeyIdentifier);
        if (!fs.existsSync(location)) {
            fs.mkdirSync(location);
        }
        location = path.join(location, transactionId);
        if (!fs.existsSync(location)) {
            fs.mkdirSync(location);
        }
        return path.join(location, fileHash);
    }

    checkReceivedFiles(addressKeyIdentifier, transactionId) {
        let directory = path.join(this.filesRootFolder, addressKeyIdentifier, transactionId);
        fs.readdir(directory, (err, files) => {
            if (err) {
                console.log('[file-manager] , ', err);
                return false;
            }
            files.forEach((file) => {
                //verify hash of each file received
            });
            return true;
        });
    }

    decryptFile(addressKeyIdentifier, transactionId, fileHash, key, publicFile) {
        return new Promise((resolve, reject) => {
            let fileLocation = this.getFileLocation(addressKeyIdentifier, transactionId, fileHash);
            fs.readFile(fileLocation, (err, file) => {
                if (err) {
                    return reject(err);
                }
                let sha256sum      = crypto.createHash('sha256');
                let fileHashReaded = sha256sum.update(file).digest('hex');
                if (fileHash !== fileHashReaded) {
                    return reject();
                }
                let keyForFile = key;
                if (!publicFile) {
                    keyForFile = this._keyCipher(key, FileManager.DECRYPT);
                }
                const cipher = crypto.createCipher('aes-256-cbc', keyForFile);

                //where i stored the decrypted file?

            });
        });
    }

    createTransactionWithFileList(fileList, fees, address) {
        return new Promise((resolve, reject) => {
            //Create directory for my files (if not exist)
            let walletKeyIdentifier  = address.address_key_identifier;
            let destinationDirectory = path.join(this.filesRootFolder, walletKeyIdentifier);
            if (!fs.existsSync(destinationDirectory)) {
                fs.mkdirSync(path.join(destinationDirectory));
            }

            //init ciphers and attributes
            const keySet                        = {};
            const sharedKeyBuffer               = crypto.randomBytes(32);
            const sharedKey                     = crypto.createSecretKey(sharedKeyBuffer).export().toString('hex');
            let transactionOutputAttribute      = {};
            transactionOutputAttribute['files'] = [];

            const promisesForTransaction = fileList.rows.map(file => new Promise((resolve, reject) => {
                let filePath   = file.path;
                let publicFile = file.public || false;
                let sha256sum  = crypto.createHash('sha256');

                //Read files to create transaction before writing them
                fs.readFile(filePath, (err, file) => {
                    if (err) {
                        return reject(err);
                    }
                    let fileHash      = sha256sum.update(file).digest('hex');
                    let fileAttribute = {
                        'public': publicFile,
                        'hash'  : fileHash,
                        'size'  : file.size,
                        'type'  : file.type,
                        'name'  : file.name
                    };
                    if (publicFile) {
                        if (!transactionOutputAttribute['shared_key']) {
                            const sharedKeyHex                       = Buffer.from(sharedKey).toString('hex');
                            transactionOutputAttribute['shared_key'] = sharedKeyHex;
                            keySet['shared_key']                     = sharedKeyHex;
                        }
                    }
                    else {
                        const fileKeyBuffer    = crypto.randomBytes(32);
                        const fileKey          = crypto.createSecretKey(fileKeyBuffer).export().toString('hex');
                        const encryptedFileKey = this._keyCipher(fileKey, FileManager.ENCRYPT);

                        fileAttribute['key'] = encryptedFileKey;
                        keySet[fileHash]     = fileKey;
                    }
                    transactionOutputAttribute['files'].push(fileAttribute);
                    resolve();
                });
            }));

            //After reading all files
            Promise.all(promisesForTransaction)
                   .then(() => {
                       return new Promise((resolve, reject) => {
                           this._createTransaction(resolve, reject, address, fees, transactionOutputAttribute);
                       });
                   })
                   .then((transactionID) => {
                       //Create transaction directory to write file
                       let transactionDirectory = path.join(destinationDirectory, transactionID);
                       if (!fs.existsSync(transactionDirectory)) {
                           fs.mkdirSync(path.join(transactionDirectory));
                       }

                       this._writeTransactionAttributeJSONFile(transactionDirectory, transactionOutputAttribute);

                       const promisesToWrite = this._writeFiles(fileList, transactionDirectory, keySet);
                       return Promise.all(promisesToWrite);

                   })
                   .then(() => {
                       resolve();
                   }).catch((err) => {
                console.log('[file-manager] error, ', err);
                reject();
            });
        });
    }

    _createTransaction(resolve, reject, address, fees, transactionAttr) {
        mutex.lock(['submit_transaction'], (unlock) => {
            wallet.addTransaction([address], {
                fee_type: 'transaction_fee_default',
                amount  : fees
            }, null, null, transactionAttr)
                  .then(transactionList => {
                      unlock();
                      resolve(transactionList[transactionList.length - 1].transaction_id);
                  })
                  .catch(error => {
                      console.log('[file-manager] error creating transaction', error);
                      unlock();
                      reject();
                  });
        });
    }

    _writeTransactionAttributeJSONFile(transactionFolder, transactionOutputAttribute) {
        let jsonOutPath     = path.join(transactionFolder, 'transaction_output_attribute_list.json');
        let jsonWriteStream = fs.createWriteStream(jsonOutPath);
        jsonWriteStream.on('error', err => console.log('[file-manager] error creating json attribute file', err));
        jsonWriteStream.write(JSON.stringify(transactionOutputAttribute, null, '\t'));
        jsonWriteStream.end();
    }

    _writeFiles(fileList, transactionFolder, keySet) {
        let sharedKeyCipher;
        if (keySet['shared_key']) {
            sharedKeyCipher = crypto.createCipher('aes-256-cbc', keySet['shared_key']);
        }

        return fileList.rows.map(file => new Promise((resolve, reject) => {
            let filePath   = file.path;
            let publicFile = file.public;
            let sha256sum  = crypto.createHash('sha256');

            const input = fs.createReadStream(filePath);
            fs.readFile(filePath, function(err, data) {
                if (err) {
                    return reject(err);
                }
                let fileHash = sha256sum.update(data).digest('hex');
                let outPath  = path.join(transactionFolder, fileHash);
                const output = fs.createWriteStream(outPath);

                if (publicFile) {
                    input.pipe(sharedKeyCipher).pipe(output);
                }
                else {
                    const fileKey    = keySet[fileHash];
                    const fileCipher = crypto.createCipher('aes-256-cbc', fileKey);
                    input.pipe(fileCipher).pipe(output);
                }
                resolve();
            });
        }));
    }

    _keyCipher(rawKey, mode) {
        let key;
        const extendedPrivateKey = wallet.getActiveWalletKey(wallet.getDefaultActiveWallet());
        if (mode === FileManager.ENCRYPT) {
            const keyBuffer = walletUtils.derivePublicKey(extendedPrivateKey, 0, 0);
            key             = encrypt(keyBuffer.toHex(), rawKey);
        }
        else if (mode === FileManager.DECRYPT) {
            const keyBuffer = walletUtils.derivePrivateKey(extendedPrivateKey, 0, 0);
            key             = decrypt(keyBuffer.toHex(), rawKey);
        }
        return key.toString('hex');
    }
}


export default new FileManager();
