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

                let walletKeyIdentifier = wallet.getKeyIdentifier();
                let personalFolder      = path.join(this.filesRootFolder, walletKeyIdentifier);
                if (!fs.existsSync(personalFolder)) {
                    fs.mkdirSync(path.join(personalFolder));
                }

                const keybuf = crypto.randomBytes(32);
                const key    = crypto.createSecretKey(keybuf).export().toString('hex');
                const cipher = crypto.createCipher('aes-256-cbc', key);
                let transationAttr = {};
                transationAttr["files"] = [];

                const promisesForTransaction = files.rows.map(upFile => new Promise((resolve, reject) => {
                        let filePath   = upFile.path;
                        let publicFile = upFile.public || false;
                        let md5sum     = crypto.createHash('md5');

                        fs.readFile(filePath, function(err, file) {
                            if (err) {
                                return reject(err);
                            }
                            let fileHash = md5sum.update(file).digest('hex');
                            if(publicFile)
                                transationAttr["shared_key"] = key;
                            transationAttr["files"].push({
                                "public": publicFile,
                                "hash": fileHash,
                                "size": upFile.size,
                                "type": upFile.type,
                                "name": upFile.name
                            });
                            resolve();
                        });
                    }));

                Promise.all(promisesForTransaction)
                       .then(() => {
                           //createTransation
                           console.log(transationAttr);
                           let transactionID = 'todo';

                           /*
                           outputAttribute={
                                    "file_list":[
                                        {
                                            "public": true/false,
                                            "hash": md5sum,
                                            "size": bytes,
                                            "type": string,
                                            "name": string
                                        }, ...
                                    ],
                                    "shared_key": string hex
                                }
                           public/private
                           key (optional)
                           * */
                           return transactionID;
                       }).then((transactionID) => {
                    let transationFolder = path.join(personalFolder, transactionID);
                    if (!fs.existsSync(transationFolder)) {
                        fs.mkdirSync(path.join(transationFolder));
                    }

                    const promisesToWrite = files.rows.map(upFile => new Promise((resolve, reject) => {
                        let filePath   = upFile.path;
                        let publicFile = upFile.public;
                        let md5sum     = crypto.createHash('md5');

                        if (publicFile) {
                            const input  = fs.createReadStream(filePath);
                            fs.readFile(filePath, function(err, file) {
                                if (err) {
                                    return reject(err);
                                }
                                let fileHash = md5sum.update(file).digest('hex');
                                let outPath  = path.join(transationFolder, fileHash);
                                const output = fs.createWriteStream(outPath);
                                input.pipe(cipher).pipe(output);
                                resolve();
                            });
                        }
                        else {
                            fs.readFile(filePath, function(err, file) {
                                if (err) {
                                    return reject(err);
                                }
                                let fileHash = md5sum.update(file).digest('hex');
                                let outPath  = path.join(transationFolder, fileHash);
                                fs.writeFile(outPath, file, err => {
                                    if (err) {
                                        return reject(err);
                                    }
                                    //file written successfully
                                    resolve();
                                });
                            });
                        }
                    }));
                    Promise.all(promisesToWrite)
                           .then(() => {
                               resolve();
                           });
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
