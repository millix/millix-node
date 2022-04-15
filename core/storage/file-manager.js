import path from 'path';
import os from 'os';
import config from '../config/config';
import fs from 'fs';
import crypto from 'crypto';
import wallet from '../wallet/wallet';
import mutex from '../mutex';
import {decrypt, encrypt} from 'eciesjs';
import walletUtils from '../wallet/wallet-utils';
import async from 'async';
import stream from 'stream';


class FileManager {
    static ENCRYPT = 'ENCRYPT';
    static DECRYPT = 'DECRYPT';

    constructor() {
    }

    initialize() {
        this.filesRootFolder = path.join(os.homedir(), config.STORAGE_CONNECTION.FOLDER);
        return Promise.resolve();
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

    createAndGetFolderLocation(folderList, rootFolder=null) {
        if(!rootFolder){
            rootFolder = this.filesRootFolder;
        }
        let location = rootFolder;

        if (!fs.existsSync(location)) {
            fs.mkdirSync(location);
        }

        folderList.forEach(folder => {
            location = path.join(location, folder);
            if (!fs.existsSync(location)) {
                fs.mkdirSync(location);
            }
        })

        return location;
    }

    createAndGetFileLocation(addressKeyIdentifier, transactionId, fileHash) {
        let location = this.createAndGetFolderLocation([addressKeyIdentifier, transactionId]);
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
                let sha256sum    = crypto.createHash('sha256');
                let fileHashRead = sha256sum.update(file).digest('hex');
                if (fileHash !== fileHashRead) {
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

    /**
     *
     * @param fileList  [
     {
                        path: <string|optional>,
                        buffer: <Buffer|optional>,
                        name  : <string>,
                        size  : <int>,
                        type  : <string>,
                        public: <boolean>
                },...
     ];
     * @param dstOutputs
     * @param outputFee
     * @return {Promise<{file_list: *, transaction_list: *}>}
     */
    createTransactionWithFileList(fileList, dstOutputs, outputFee) {
        //Create directory for my files (if not exist)
        const walletKeyIdentifier  = dstOutputs[0].address_key_identifier;
        const destinationDirectory = path.join(this.filesRootFolder, walletKeyIdentifier);
        if (!fs.existsSync(destinationDirectory)) {
            fs.mkdirSync(path.join(destinationDirectory));
        }

        let transactionTempDirectory = path.join(destinationDirectory, 'tmp');
        if (!fs.existsSync(transactionTempDirectory)) {
            fs.mkdirSync(path.join(transactionTempDirectory));
        }

        return this._createEncryptedFiles(fileList, transactionTempDirectory)
                   .then(data => {
                       return wallet.addTransaction(dstOutputs, outputFee, null, config.MODE_TEST_NETWORK ? 'la3l' : '0a3l', data.transaction_output_attribute)
                                    .then(transactionList => ({
                                        ...data,
                                        transaction_list: transactionList
                                    }));
                   })
                   .then(data => {
                       const transactionList    = data.transaction_list;
                       const transaction        = transactionList[transactionList.length - 1];
                       //Create transaction directory to write file
                       let transactionDirectory = path.join(destinationDirectory, transaction.transaction_id);
                       if (!fs.existsSync(transactionDirectory)) {
                           fs.mkdirSync(path.join(transactionDirectory));
                       }

                       return this.writeTransactionAttributeJSONFile(data.transaction_output_attribute, transactionDirectory)
                                  .then(() => this._moveEncryptedFiles(data.file_list, transactionDirectory))
                                  .then(fileList => ({
                                      file_list       : fileList,
                                      transaction_list: transactionList
                                  }));

                   })
                   .catch((err) => {
                       console.log('[file-manager] error, ', err);
                       return Promise.reject(err.error ? err : {
                           error: 'transaction_data_error',
                           data : {
                               message: err.message
                           }
                       });
                   });
    }

    writeTransactionAttributeJSONFile(transactionOutputAttribute, transactionFolder) {
        let jsonOutPath     = path.join(transactionFolder, 'transaction_output_metadata.json');
        let jsonWriteStream = fs.createWriteStream(jsonOutPath);
        return new Promise((resolve, reject) => {
            jsonWriteStream.write(JSON.stringify(transactionOutputAttribute, null, '\t'),
                error => {
                    if (error) {
                        console.log('[file-manager] error creating json attribute file', error);
                        return reject(error);
                    }
                    jsonWriteStream.close();
                    resolve();
                });
        });
    }

    _moveEncryptedFiles(fileList, destinationFolder) {
        const moveFiles = () => new Promise((resolve, reject) => {
            async.eachSeries(fileList, (file, callback) => {
                let newPath = path.join(destinationFolder, file.hash);
                fs.rename(file.path, newPath, (err) => {
                    if (err) {
                        return callback(err);
                    }
                    file.path = newPath;
                    callback();
                });
            }, err => err ? reject(err) : resolve());
        });
        return moveFiles().then(() => fileList);
    }

    _createEncryptedFiles(fileList, destinationFolder) {

        //init ciphers and attributes
        const keySet          = {};
        keySet['shared_key']  = crypto.createSecretKey(crypto.randomBytes(32)).export().toString('hex');
        const sharedKeyCipher = crypto.createCipher('aes-256-cbc', keySet['shared_key']);

        const encryptAndWriteFile = () => new Promise((resolve, reject) => {
            async.eachSeries(fileList, (file, callback) => {
                if (!file.path && !file.buffer) {
                    return callback(true);
                }
                let input;
                if (file.path) {
                    input = fs.createReadStream(file.path);
                }
                else {
                    input = new stream.Readable();
                    input.push(file.buffer);
                    input.push(null);
                }
                let outPath = path.join(destinationFolder, file.name);
                //update file path
                file.path   = outPath;

                const output = fs.createWriteStream(outPath);

                input.on('error', (err) => {
                    callback(err);
                });

                if (file.public) {
                    input.pipe(sharedKeyCipher)
                         .pipe(output)
                         .on('finish', () => {
                             callback();
                         });
                }
                else {
                    keySet[file.name] = crypto.createSecretKey(crypto.randomBytes(32)).export().toString('hex');
                    const fileCipher  = crypto.createCipher('aes-256-cbc', keySet[file.name]);
                    input.pipe(fileCipher)
                         .pipe(output)
                         .on('finish', () => {
                             callback();
                         });
                }
            }, err => err ? reject(err) : resolve());
        });

        const transactionOutputAttribute = {
            file_list: []
        };

        const computeFileHashCreateOutputAttribute = () => new Promise((resolve, reject) => {
            async.eachSeries(fileList, (file, callback) => {
                const sha256sum = crypto.createHash('sha256').setEncoding('hex');
                fs.createReadStream(file.path)
                  .on('error', err => callback(err))
                  .pipe(sha256sum)
                  .on('finish', () => {
                      file.hash = sha256sum.read();

                      const fileAttribute = {
                          'public': file.public,
                          'hash'  : file.hash,
                          'size'  : file.size,
                          'type'  : file.type,
                          'name'  : file.name
                      };

                      if (file.public) {
                          if (!transactionOutputAttribute['shared_key']) {
                              transactionOutputAttribute['shared_key'] = keySet['shared_key'];
                          }
                      }
                      else {
                          const encryptedFileKey = this._keyCipher(keySet[file.name], FileManager.ENCRYPT);
                          fileAttribute['key']   = encryptedFileKey;
                      }
                      transactionOutputAttribute.file_list.push(fileAttribute);
                      callback();
                  });
            }, err => err ? reject(err) : resolve());
        });

        return encryptAndWriteFile()
            .then(() => computeFileHashCreateOutputAttribute())
            .then(() => ({
                file_list                   : fileList,
                transaction_output_attribute: transactionOutputAttribute
            }))
            .catch(err => Promise.reject({
                error: 'transaction_data_error',
                data : {message: err.message}
            }));
    }

    _keyCipher(rawKey, mode) {
        let key;
        const extendedPrivateKey = wallet.getActiveWalletKey(wallet.getDefaultActiveWallet());
        if (mode === FileManager.ENCRYPT) {
            const keyBuffer = walletUtils.derivePublicKey(extendedPrivateKey, 0, 0);
            key             = encrypt(keyBuffer, rawKey);
        }
        else if (mode === FileManager.DECRYPT) {
            const keyBuffer = walletUtils.derivePrivateKey(extendedPrivateKey, 0, 0);
            key             = decrypt(keyBuffer, rawKey);
        }
        return key.toString('hex');
    }
}


export default new FileManager();
