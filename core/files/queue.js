import path from 'path';
import os from 'os';
import fs from 'fs';
import mutex from '../mutex';
import console from '../console';
import config from '../config/config';


class Queue {
    constructor() {
        this.filesRootFolder            = path.join(os.homedir(), config.FILES_CONNECTION.FOLDER);

        this.filesPendingToSend         = path.join(os.homedir(), config.FILES_CONNECTION.PENDING_TO_SEND);
        this.listOfPendingFilesInSender = [];
        this.countActiveSenderServers   = 0;

        this.filesPendingToReceive      = path.join(os.homedir(), config.FILES_CONNECTION.PENDING_TO_RECEIVE);
        this.listOfPendingFilesInReceiver = [];
        this.countActiveReceiverServers = 0;
    }

    initializeSender() {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(this.filesPendingToSend)) {
                fs.closeSync(fs.openSync(this.filesPendingToSend, 'w'))
            }
            this._loadPendingFilesInSender();
            resolve();
        });
    }

    initializeReceiver() {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(this.filesPendingToReceive)) {
                fs.closeSync(fs.openSync(this.filesPendingToReceive, 'w'))
            }
            this._loadPendingFilesInReceiver();
            resolve();
        });
    }

    _buildEntry(fileLocation, destination, receiver_public){
        return destination + ';' + receiver_public + ';' + fileLocation + '\n';
    }

    /***********************
     * Sender methods
     ***********************/
    incrementServerInstancesInSender(){
        mutex.lock(['update_active_servers'], (unlock) => {
            this.countActiveSenderServers += 1;
            unlock();
        });
    }

    decrementServerInstancesInSender(){
        mutex.lock(['update_active_servers'], (unlock) => {
            if(this.countActiveSenderServers > 0)
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

    getListOfPendingFilesInSender(){
        return this.listOfPendingFilesInSender;
    }

    addNewFileInSender(fileLocation, destination, receiver_public) {
        let newEntry = this._buildEntry(fileLocation, destination, receiver_public);
        mutex.lock(['update_log_for_sending_files'], (unlock) => {
            fs.appendFileSync(this.filesPendingToSend, newEntry);
            this.listOfPendingFilesInSender.append({
                destination    : destination,
                receiver_public: receiver_public,
                fileLocation   : fileLocation
            });
            unlock();
        });
    }

    removeEntryFromSender(requestInfo) {
        let entryToRemove = this._buildEntry(requestInfo.fileLocation, requestInfo.destination, requestInfo.receiver_public);
        mutex.lock(['update_log_for_sending_files'], (unlock) => {
            fs.closeSync(fs.openSync(this.filesPendingToSend, 'w'))
            this.listOfPendingFilesInSender.forEach(fileInfo => {
                let entry= this._buildEntry(fileInfo.fileLocation, fileInfo.destination, fileInfo.receiver_public);
                if (entry !== entryToRemove){
                    fs.appendFileSync(this.filesPendingToSend, entry);
                }
            })
            unlock();
        });
    }

    _loadPendingFilesInSender(){
        mutex.lock(['update_log_for_sending_files'], (unlock) => {
            let content = fs.readFileSync(this.filesPendingToSend);
            content.split(/\r?\n/).forEach(line => {
                let elements = line.split(';');
                this.listOfPendingFilesInSender.append({
                    destination    : elements[0],
                    receiver_public: elements[1],
                    fileLocation   : elements[2]
                });
            });
            unlock();
        });
    }

    /***********************
     * Receiver methods
     ***********************/
    incrementServerInstancesInReceiver(){
        mutex.lock(['update_active_servers'], (unlock) => {
            this.countActiveReceiverServers += 1;
            unlock();
        });
    }

    decrementServerInstancesInReceiver(){
        mutex.lock(['update_active_servers'], (unlock) => {
            if(this.countActiveReceiverServers > 0)
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

    getListOfPendingFilesInReceiver(){
        return this.listOfPendingFilesInReceiver;
    }

    addNewFileInReceiver(fileLocation, destination, receiver_public) {
        let newEntry = this._buildEntry(fileLocation, destination, receiver_public);
        mutex.lock(['update_log_for_sending_files'], (unlock) => {
            fs.appendFileSync(this.filesPendingToReceive, newEntry);
            this.listOfPendingFilesInReceiver.append({
                destination    : destination,
                receiver_public: receiver_public,
                fileLocation   : fileLocation
            });
            unlock();
        });
    }

    removeEntryFromReceiver(requestInfo) {
        let entryToRemove = this._buildEntry(requestInfo.fileLocation, requestInfo.destination, requestInfo.receiver_public);
        mutex.lock(['update_log_for_sending_files'], (unlock) => {
            fs.closeSync(fs.openSync(this.filesPendingToReceive, 'w'))
            this.listOfPendingFilesInReceiver.forEach(fileInfo => {
                let entry= this._buildEntry(fileInfo.fileLocation, fileInfo.destination, fileInfo.receiver_public);
                if (entry !== entryToRemove){
                    fs.appendFileSync(this.filesPendingToReceive, entry);
                }
            })
            unlock();
        });
    }

    _loadPendingFilesInReceiver(){
        mutex.lock(['update_log_for_sending_files'], (unlock) => {
            let content = fs.readFileSync(this.filesPendingToReceive);
            content.split(/\r?\n/).forEach(line => {
                let elements = line.split(';');
                this.listOfPendingFilesInReceiver.append({
                    destination    : elements[0],
                    receiver_public: elements[1],
                    fileLocation   : elements[2]
                });
            });
            unlock();
        });
    }

}

export default new Queue();
