import WebSocket, {Server} from 'ws';
import path from 'path';
import os from 'os';
import fs from 'fs';
import config, {CHUNK_SIZE} from '../config/config';

class Chunker {
    constructor() {
        this.filesRootFolder = path.join(os.homedir(), config.FILES_CONNECTION.FOLDER);
    }

    writeFile(wallet, transactionId, file, chunk){
        return new Promise((resolve, reject) => {
            let location = path.join(this.filesRootFolder, wallet);
            if (!fs.existsSync(location)) {
                fs.mkdirSync(location);
            }

            location = path.join(location, transactionId);
            if (!fs.existsSync(location)) {
                fs.mkdirSync(location);
            }

            location = path.join(location, file);
            fs.appendFile(location, chunk, (err) => {
                if (err) {
                    console.log(err);
                    return reject();
                }
                resolve();
            });
        })

    }

    getChunck(fileLocation, position){
        return new Promise((resolve, reject)=>{
            let offset = position * CHUNK_SIZE;
            fs.readFile(fileLocation, function(err, file) {
                if (err) {
                    return reject(err);
                }
                resolve(file.slice(offset, offset+CHUNK_SIZE));
            });
        })
    }

    getChunckSize(file){
        let stats = fs.statSync(file)
        let fileSizeInBytes = stats.size;
        return fileSizeInBytes / CHUNK_SIZE;
    }
}

export default new Chunker();
