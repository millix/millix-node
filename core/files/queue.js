import path from 'path';
import os from 'os';
import fs from 'fs';
import mutex from '../mutex';
import console from '../console';
import config from '../config/config';


class Queue {
    constructor() {
        this.filesRootFolder    = null;
        this.filesPendingToSend = null;
        this.listOfPendingFiles = [];
        this.countActiveSenderServers = 0;
        this.countActiveReceiverServers = 0;
    }

    initialize() {
        return new Promise((resolve, reject) => {
            this.filesRootFolder    = path.join(os.homedir(), config.FILES_CONNECTION.FOLDER);
            //this.filesPendingToSend = path.join(os.homedir(), config.FILES_CONNECTION.PENDING_TO_SEND);
            this.filesPendingToSend = path.join(this.filesRootFolder, 'pending.log');//CHANGE THIS
            if (!fs.existsSync(this.filesPendingToSend)) {
                fs.closeSync(fs.openSync(this.filesPendingToSend, 'w'))
            }
            this._loadPendingFiles();
            resolve();
        });
    }

    incrementSenderServerInstances(){
        mutex.lock(['update_active_servers'], (unlock) => {
            this.countActiveSenderServers += 1;
            unlock();
        });
    }

    decrementSenderServerInstances(){
        mutex.lock(['update_active_servers'], (unlock) => {
            this.countActiveSenderServers -= 1;
            unlock();
        });
    }

    anyActiveSenderServer(){
        let activeServers;
        mutex.lock(['update_active_servers'], (unlock) => {
            activeServers = this.countActiveSenderServers;
            unlock();
        });
        return activeServers !== 0;
    }

    incrementReceiverServerInstances(){
        mutex.lock(['update_active_servers'], (unlock) => {
            this.countActiveReceiverServers += 1;
            unlock();
        });
    }

    decrementReceiverServerInstances(){
        mutex.lock(['update_active_servers'], (unlock) => {
            this.countActiveReceiverServers -= 1;
            unlock();
        });
    }

    anyActiveReceiverServer(){
        let activeServers;
        mutex.lock(['update_active_servers'], (unlock) => {
            activeServers = this.countActiveReceiverServers;
            unlock();
        });
        return activeServers !== 0;
    }


    getListOfPendingFiles(){
        return this.listOfPendingFiles;
    }

    addNewFile(fileLocation, destination, receiver_public) {
        let newEntry = this._buildEntry(fileLocation, destination, receiver_public);
        mutex.lock(['update_log_for_sending_files'], (unlock) => {
            fs.appendFileSync(this.filesPendingToSend, newEntry);
            this.listOfPendingFiles.append({
                destination    : destination,
                receiver_public: receiver_public,
                fileLocation   : fileLocation
            });
            unlock();
        });
    }

    removeEntry(requestInfo) {
        let entryToRemove = this._buildEntry(requestInfo.fileLocation, requestInfo.destination, requestInfo.receiver_public);
        mutex.lock(['update_log_for_sending_files'], (unlock) => {
            fs.closeSync(fs.openSync(this.filesPendingToSend, 'w'))
            this.listOfPendingFiles.forEach(fileInfo => {
                let entry= this._buildEntry(fileInfo.fileLocation, fileInfo.destination, fileInfo.receiver_public);
                if (entry !== entryToRemove){
                    fs.appendFileSync(this.filesPendingToSend, entry);
                }
            })
            unlock();
        });
    }

    _loadPendingFiles(){
        mutex.lock(['update_log_for_sending_files'], (unlock) => {
            let content = fs.readFileSync(this.filesPendingToSend);
            content.split(/\r?\n/).forEach(line => {
                let elements = line.split(';');
                this.listOfPendingFiles.append({
                    destination    : elements[0],
                    receiver_public: elements[1],
                    fileLocation   : elements[2]
                });
            });
            unlock();
        });
    }

    _buildEntry(fileLocation, destination, receiver_public){
        return destination + ';' + receiver_public + ';' + fileLocation + '\n';
    }
}

export default new Queue();
