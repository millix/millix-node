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
import {promisify} from 'util';
import utils from '../utils/utils';

const readdir = promisify(fs.readdir);
const rmdir   = promisify(fs.rmdir);
const unlink  = promisify(fs.unlink);


class FileManager {
    static ENCRYPT = 'ENCRYPT';
    static DECRYPT = 'DECRYPT';

    constructor() {
    }

    initialize() {
        this.filesRootFolder = config.STORAGE_CONNECTION.FOLDER;
        return Promise.resolve();
    }

    _normalizeDateFolder(transactionDate) {
        return (transactionDate - (transactionDate % 86400)).toString();
    }

    getFileLocation(addressKeyIdentifier, transactionDate, transactionId, fileHash) {
        if (!this.filesRootFolder) {
            return null;
        }
        return path.join(this.filesRootFolder, addressKeyIdentifier, this._normalizeDateFolder(transactionDate), transactionId, fileHash);
    }

    hasFile(addressKeyIdentifier, transactionDate, transactionId, fileHash) {
        return new Promise((resolve) => {
            const filePath = this.getFileLocation(addressKeyIdentifier, transactionDate, transactionId, fileHash);
            fs.exists(filePath, (exists) => {
                return resolve(exists);
            });
        });
    }

    _createAndGetFolderLocation(folderList, rootFolder = null) {
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

    createAndGetFolderLocation(addressKeyIdentifier, transactionDate, transactionId) {
        return this._createAndGetFolderLocation([
            addressKeyIdentifier,
            this._normalizeDateFolder(transactionDate),
            transactionId
        ]);
    }

    removeDirectory(dir) {
        return readdir(dir, {withFileTypes: true})
            .then(entries => Promise.all(entries.map(entry => {
                let fullPath = path.join(dir, entry.name);
                return entry.isDirectory() ? this.removeDirectory(fullPath) : unlink(fullPath);
            })))
            .then(() => rmdir(dir));
    }

    createAndGetFileLocation(addressKeyIdentifier, transactionDate, transactionId, fileHash) {
        const folderLocation = this.createAndGetFolderLocation(addressKeyIdentifier, transactionDate, transactionId);
        return path.join(folderLocation, fileHash);
    }

    _checkFileHash(fileLocation, fileHash) {
        return new Promise((resolve, reject) => {
            const sha256sum = crypto.createHash('sha256').setEncoding('hex');
            fs.createReadStream(fileLocation)
              .on('error', err => reject(err))
              .pipe(sha256sum)
              .on('finish', () => {
                  const hash = sha256sum.read();
                  if (hash !== fileHash) {
                      return reject('transaction_file_hash_error');
                  }
                  resolve(true);
              });
        });
    }

    checkFile(addressKeyIdentifier, transactionDate, transactionId, fileHash) {
        let fileLocation = this.getFileLocation(addressKeyIdentifier, transactionDate, transactionId, fileHash);
        if (!fileLocation) {
            return Promise.reject('transaction_file_not_found');
        }
        return this._checkFileHash(fileLocation, fileHash);
    }

    decryptFile(addressKeyIdentifier, transactionDate, transactionId, fileHash, key, isKeyDecrypted) {
        let fileLocation = this.getFileLocation(addressKeyIdentifier, transactionDate, transactionId, fileHash);
        if (!fileLocation) {
            return Promise.reject('transaction_file_not_found');
        }

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

        return this._checkFileHash(fileLocation, fileHash).then(() => decryptAndReadFile());
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
     * @param defaultTransactionOutputAttribute
     * @return {Promise<{file_list: *, transaction_list: *}>}
     */
    createTransactionWithFileList(fileList, dstOutputs, outputFee, defaultTransactionOutputAttribute = {}) {
        //Create directory for my files (if not exist)
        const transactionTempDirectory = this._createAndGetFolderLocation([
            wallet.defaultKeyIdentifier,
            'tmp'
        ]);

        return this._getPublicKeyMap(dstOutputs)
                   .then((publicKeyBufferMap) => this._createEncryptedFiles(fileList, transactionTempDirectory, publicKeyBufferMap, defaultTransactionOutputAttribute))
                   .then(data => {
                       return wallet.addTransaction(dstOutputs, outputFee, null, config.MODE_TEST_NETWORK ? 'la3l' : '0a30', data.transaction_output_attribute)
                                    .then(transactionList => ({
                                        ...data,
                                        transaction_list: transactionList
                                    }));
                   })
                   .then(data => {
                       const transactionList    = data.transaction_list;
                       const transaction        = transactionList[transactionList.length - 1];
                       //Create transaction directory to write file
                       let transactionDirectory = this.createAndGetFolderLocation(wallet.defaultKeyIdentifier, transaction.transaction_date, transaction.transaction_id);

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
                const addressPublicKey = output.address_public_key;
                delete output['address_public_key'];
                if (publicKeyBufferMap[output.address_key_identifier]) {
                    return callback();
                }

                utils.orElsePromise(addressPublicKey, () => addressRepository.getAddressBaseAttribute(output.address_key_identifier, 'key_public'))
                     .then(publicKey => {
                         if (!publicKey) {
                             return reject('public_key_not_found');
                         }
                         publicKeyBufferMap[output.address_key_identifier] = base58.decode(publicKey);
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

    readTransactionAttributeJSONFile(transactionFolder) {
        return new Promise((resolve, reject) => {
            fs.readFile(path.join(transactionFolder, 'transaction_output_metadata.json'), 'utf8', (err, data) => {
                if (err) {
                    return reject('transaction_output_attribute_file_invalid');
                }
                resolve(JSON.parse(data));
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

    _createEncryptedFiles(fileList, destinationFolder, publicKeyBufferMap, defaultTransactionOutputAttribute = {}) {

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

        let transactionOutputAttribute = {
            ...defaultTransactionOutputAttribute,
            file_list: []
        };

        // sort keys - important! if not sorted the signature verification might fail
        transactionOutputAttribute = Object.keys(transactionOutputAttribute).sort().reduce(
            (obj, key) => {
                obj[key] = transactionOutputAttribute[key];
                return obj;
            },
            {}
        );

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
