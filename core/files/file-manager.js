import path from 'path';
import os from 'os';
import config from '../config/config';
import fs from 'fs';
import crypto from 'crypto';
import wallet from '../wallet/wallet';
import mutex from '../mutex';

const ENCRYPT = "encrypt";
const DECRYPT = "decrypt";

class FileManager {
    constructor() {
        this.filesRootFolder = path.join(os.homedir(), config.FILES_CONNECTION.FOLDER);
    }

    getFileLocation(addressKeyIdentifier, transactionId, fileHash){
        return path.join(this.filesRootFolder, addressKeyIdentifier, transactionId, fileHash);
    }

    createAndGetFileLocation(addressKeyIdentifier, transactionId, fileHash){
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

    generateNFT(files, fees, address) {
        return new Promise((resolve, reject) => {
            fs.readFile(path.join(os.homedir(), config.WALLET_KEY_PATH), 'utf8', (err, data) => {
                //Verify if mnemonic is available
                if (err) {
                    return reject('Couldn\'t read wallet mnemonic');
                }

                //Create directory for my files (if not exist)
                let walletKeyIdentifier = address.address_key_identifier;
                let destinationDirectory      = path.join(this.filesRootFolder, walletKeyIdentifier);
                if (!fs.existsSync(destinationDirectory)) {
                    fs.mkdirSync(path.join(destinationDirectory));
                }

                //Init ciphers and attr
                const self               = this;
                const keybuf             = crypto.randomBytes(32);
                const key                = crypto.createSecretKey(keybuf).export().toString('hex');
                const cipher             = crypto.createCipher('aes-256-cbc', key);
                const keys               = {};
                let transactionAttr      = {};
                transactionAttr['files'] = [];

                const promisesForTransaction = files.rows.map(upFile => new Promise((resolve, reject) => {
                    let filePath   = upFile.path;
                    let publicFile = upFile.public || false;
                    let sha256sum  = crypto.createHash('sha256');

                    //Read files to create transaction before writing them
                    fs.readFile(filePath, function(err, file) {
                        if (err) {
                            return reject(err);
                        }
                        let fileHash = sha256sum.update(file).digest('hex');
                        let fileAttr = {
                            'public': publicFile,
                            'hash'  : fileHash,
                            'size'  : upFile.size,
                            'type'  : upFile.type,
                            'name'  : upFile.name
                        };
                        if (publicFile) {
                            transactionAttr['shared_key'] = btoa(key);
                        }
                        else {
                            const individualKeybuf = crypto.randomBytes(32);
                            const individualKey    = crypto.createSecretKey(individualKeybuf).export().toString('hex');
                            const encKey           = self._protectKey(individualKey, ENCRYPT);

                            fileAttr['key'] = encKey;
                            keys[fileHash]  = individualKey;
                        }
                        transactionAttr['files'].push(fileAttr);
                        resolve();
                    });
                }));

                //After reading all files
                Promise.all(promisesForTransaction)
                       .then(() => {
                           return new Promise((resolve, reject) => {
                               this._createTransaction(resolve, reject, address, fees, transactionAttr);
                           });
                       })
                       .then((transactionID) => {
                           //Create transaction directory to write file
                           let transationFolder = path.join(destinationDirectory, transactionID);
                           if (!fs.existsSync(transationFolder)) {
                               fs.mkdirSync(path.join(transationFolder));
                           }

                           this._writeTransactionAttrJSONFile(transationFolder, transactionAttr);

                           const promisesToWrite = this._writeFiles(files, transationFolder, cipher, keys);
                           return Promise.all(promisesToWrite);

                       })
                       .then(() => {
                           resolve();
                       }).catch((err) => {
                            console.log("[file-manager] error, ", err);
                            reject();
                       });
            });
        });
    }

    _createTransaction(resolve, reject, address, fees, transactionAttr) {
        mutex.lock(['submit_transaction'], (unlock) => {
            wallet.addTransaction([address], {
                fee_type: 'transaction_fee_default',
                amount  : fees
            }, null, null, transactionAttr)
                  .then(transaction => {
                      unlock();
                      resolve(transaction[0].transaction_id);
                  })
                  .catch(e => {
                      console.log(`error`);
                      unlock();
                      reject();
                  });
        });
    }

    _writeTransactionAttrJSONFile(transationFolder, transactionAttr) {
        let jsonOutPath     = path.join(transationFolder, 'transaction_output_attribute_list.json');
        let jsonWriteStream = fs.createWriteStream(jsonOutPath);
        jsonWriteStream.on('error', err => console.log);
        jsonWriteStream.write(JSON.stringify(transactionAttr, null, '\t'));
        jsonWriteStream.end();
    }

    _writeFiles(files, transationFolder, publicChiper, keys) {
        return files.rows.map(upFile => new Promise((resolve, reject) => {
            let filePath   = upFile.path;
            let publicFile = upFile.public;
            let sha256sum  = crypto.createHash('sha256');

            const input = fs.createReadStream(filePath);
            fs.readFile(filePath, function(err, file) {
                if (err) {
                    return reject(err);
                }
                let fileHash = sha256sum.update(file).digest('hex');
                let outPath  = path.join(transationFolder, fileHash);
                const output = fs.createWriteStream(outPath);

                if (publicFile) {
                    input.pipe(publicChiper).pipe(output);
                }
                else {
                    const individualKey    = keys[fileHash];
                    const individualCipher = crypto.createCipher('aes-256-cbc', individualKey);
                    input.pipe(individualCipher).pipe(output);
                }
                resolve();
            });
        }));
    }

    _protectKey(individualKey, mode){
        let key;
        if (mode === ENCRYPT){
            //to do
            key = btoa(individualKey);
        }
        else if (mode === DECRYPT){
            //to do
            key = btoa(individualKey);
        }
        return key;
    }
}


export default new FileManager();
