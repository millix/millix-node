import path from 'path';
import os from 'os';
import config from '../config/config';
import fs from 'fs';
import crypto from 'crypto';
import wallet from '../wallet/wallet';


class FileManager {
    constructor() {
        this.filesRootFolder = null;
    }

    initialize() {
        this.filesRootFolder = path.join(os.homedir(), config.FILES_CONNECTION.FOLDER);
        if (!fs.existsSync(this.filesRootFolder)) {
            fs.mkdirSync(path.join(this.filesRootFolder));
        }
    }

    uploadFiles(files) {
        return new Promise((resolve, reject) => {
            fs.readFile(path.join(os.homedir(), config.WALLET_KEY_PATH), 'utf8', (err, data) => {
                if (err) {
                    return reject('Couldn\'t read wallet mnemonic');
                }

                var walletKeyIdentifier = wallet.getKeyIdentifier();
                var personalFolder      = path.join(this.filesRootFolder, walletKeyIdentifier);
                if (!fs.existsSync(personalFolder)) {
                    fs.mkdirSync(path.join(personalFolder));
                }

                // Transaction missing here
                var transactionID = "to do";
                var transationFolder = path.join(personalFolder, transactionID);
                if (!fs.existsSync(transationFolder)) {
                    fs.mkdirSync(path.join(transationFolder));
                }

                const promises = files.rows.map(upFile => {
                    let filePath = upFile.path;
                    var md5sum   = crypto.createHash('md5');
                    fs.readFile(filePath, function(err, file) {
                        if (err) {
                            return reject(err);
                        }
                        var fileHash = md5sum.update(file).digest('hex');
                        let outPath  = path.join(transationFolder, fileHash);
                        fs.writeFile(outPath, file, err => {
                            if (err) {
                                return reject(err);
                            }
                            //file written successfully
                        });
                    });
                });
                Promise.all(promises)
                       .then(() => {
                           resolve();
                       });
            });
        });
    }

    writeFiles(files) {

    }

    readFile(file) {

    }

    writeEncriptedFiles(files) {

    }

    readEncriptedFile(file) {

    }


}


export default new FileManager();
