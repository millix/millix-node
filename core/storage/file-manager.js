import path from 'path';
import os from 'os';
import config from '../config/config';
import fs from 'fs';
import crypto from 'crypto';
import wallet from '../wallet/wallet';
import {decrypt, encrypt} from 'eciesjs';
import walletUtils from '../wallet/wallet-utils';
import async from 'async';
import stream from 'stream';
import database from '../../database/database';
import base58 from 'bs58';
import _ from 'lodash';


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
        if (!this.filesRootFolder) {
            return null;
        }
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

    createAndGetFolderLocation(folderList, rootFolder = null) {
        if (!rootFolder) {
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
        });

        return location;
    }

    createAndGetFileLocation(addressKeyIdentifier, transactionId, fileHash) {
        let location = this.createAndGetFolderLocation([
            addressKeyIdentifier,
            transactionId
        ]);
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

    decryptFile(addressKeyIdentifier, transactionId, fileHash, key, isKeyDecrypted) {
        let fileLocation = this.getFileLocation(addressKeyIdentifier, transactionId, fileHash);
        if (!fileLocation) {
            return Promise.reject('transaction_file_not_found');
        }

        const checkHash = () => new Promise((resolve, reject) => {
            const sha256sum = crypto.createHash('sha256').setEncoding('hex');
            fs.createReadStream(fileLocation)
              .on('error', err => reject(err))
              .pipe(sha256sum)
              .on('finish', () => {
                  const hash = sha256sum.read();
                  if (hash !== fileHash) {
                      return reject('transaction_file_hash_error');
                  }
                  resolve();
              });
        });

        const decryptAndReadFile = () => new Promise((resolve, reject) => {
            if (!isKeyDecrypted) {
                const extendedPrivateKey = wallet.getActiveWalletKey(wallet.getDefaultActiveWallet());
                const privateKeyBuffer   = walletUtils.derivePrivateKey(extendedPrivateKey, 0, 0);
                key                      = this._keyCipher(Buffer.from(key, 'hex'), privateKeyBuffer, FileManager.DECRYPT);
            }

            const decipher = crypto.createDecipher('aes-256-cbc', key);

            const buffers = [];
            fs.createReadStream(fileLocation)
              .on('error', (err) => {
                  reject(err);
              })
              .on('data', data => {
                  buffers.push(decipher.update(data));
              })
              .on('end', () => {
                  buffers.push(decipher.final());
                  resolve(Buffer.concat(buffers));
              });
        });

        return checkHash().then(() => decryptAndReadFile());
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
        const destinationDirectory = path.join(this.filesRootFolder, wallet.defaultKeyIdentifier);
        if (!fs.existsSync(destinationDirectory)) {
            fs.mkdirSync(path.join(destinationDirectory));
        }

        let transactionTempDirectory = path.join(destinationDirectory, 'tmp');
        if (!fs.existsSync(transactionTempDirectory)) {
            fs.mkdirSync(path.join(transactionTempDirectory));
        }

        return this._getPublicKeyMap(dstOutputs)
                   .then((publicKeyBufferMap) => this._createEncryptedFiles(fileList, transactionTempDirectory, publicKeyBufferMap))
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

    _getPublicKeyMap(dstOutputs) {
        return new Promise((resolve, reject) => {
            const addressRepository    = database.getRepository('address');
            const addressKeyIdentifier = wallet.defaultKeyIdentifier;
            const extendedPrivateKey   = wallet.getActiveWalletKey(wallet.getDefaultActiveWallet());
            const publicKeyBufferMap   = {
                [addressKeyIdentifier]: walletUtils.derivePublicKey(extendedPrivateKey, 0, 0)
            };
            async.eachSeries(dstOutputs, (output, callback) => {
                if (publicKeyBufferMap[output.address_key_identifier]) {
                    return callback();
                }

                addressRepository.getAddressBaseAttribute(output.address_key_identifier, 'key_public')
                                 .then(publicKey => {
                                     if (!publicKey) {
                                         return reject('public_key_not_found');
                                     }
                                     const publicKeyBuffer                             = base58.decode(publicKey);
                                     publicKeyBufferMap[output.address_key_identifier] = publicKeyBuffer;
                                     callback();
                                 });
            }, err => err ? reject(err) : resolve(publicKeyBufferMap));
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

    _createEncryptedFiles(fileList, destinationFolder, publicKeyBufferMap) {

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
                          _.each(publicKeyBufferMap, (publicKeyBuffer, addressKeyIdentifier) => {
                              const encryptedFileKey              = this._keyCipher(keySet[file.name], publicKeyBuffer, FileManager.ENCRYPT).toString('hex');
                              fileAttribute[addressKeyIdentifier] = {key: encryptedFileKey};
                          });
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

    _keyCipher(rawKey, keyBuffer, mode) {
        if (mode === FileManager.ENCRYPT) {
            return encrypt(keyBuffer, rawKey);
        }
        else if (mode === FileManager.DECRYPT) {
            return decrypt(keyBuffer, rawKey);
        }
    }
}


export default new FileManager();
