import cache from '../cache';
import _ from 'lodash';


class StorageAcl {

    constructor() {

    }

    /***********************
     * Sender methods
     ***********************/

    addNewFileToSender(nodeId, transactionId, fileHash) {
        let cachedData = cache.getCacheItem('storage-acl-sender', nodeId);
        if (!cachedData) {
            cachedData = {};
            cache.setCacheItem('storage-acl-sender', nodeId, cachedData, 1800000); //30min cache
        }

        if (!cachedData[transactionId]) {
            cachedData[transactionId] = {};
        }
        cachedData[transactionId][fileHash] = true;
    }

    removeEntryFromSender(nodeId, transactionId) {
        const cachedData = cache.getCacheItem('storage-acl-sender', nodeId);
        if (cachedData) {
            delete cachedData[transactionId];
        }
        if (_.isEmpty(cachedData)) {
            cache.removeCacheItem('storage-acl-sender', nodeId);
        }
    }

    hasFileToSend(nodeId, transactionId, fileHash) {
        const cachedData = cache.getCacheItem('storage-acl-sender', nodeId);
        if (!cachedData) {
            return false;
        }
        return cachedData[transactionId] && cachedData[transactionId][fileHash];
    }

    hasTransactionRequest(nodeId, transactionId) {
        const cachedData = cache.getCacheItem('storage-acl-sender', nodeId);
        if (!cachedData) {
            return false;
        }
        return cachedData[transactionId];
    }


    /***********************
     * Receiver methods
     ***********************/

    addChunkToReceiver(nodeId, transactionId, fileHash, requestedChunk) {
        let cachedData = cache.getCacheItem('storage-acl-receiver', nodeId);
        if (!cachedData) {
            cachedData = {};
            cache.setCacheItem('storage-acl-sender', nodeId, cachedData, 1800000); //30min cache
        }
        if (!cachedData[transactionId]) {
            cachedData[transactionId] = {};
        }

        if (!cachedData[transactionId][fileHash]) {
            cachedData[transactionId][fileHash] = {};
        }

        cachedData[transactionId][fileHash][requestedChunk] = true;
    }

    removeFileFromReceiver(nodeId, transactionId) {
        const cachedData = cache.getCacheItem('storage-acl-receiver', nodeId);
        if (cachedData) {
            delete cachedData[transactionId];
        }
        if (_.isEmpty(cachedData)) {
            cache.removeCacheItem('storage-acl-receiver', nodeId);
        }
    }

    removeChunkFromReceiver(nodeId, transactionId, fileHash, requestedChunk) {
        const cachedData = cache.getCacheItem('storage-acl-receiver', nodeId);
        if (cachedData && cachedData[transactionId] && cachedData[transactionId][fileHash] && cachedData[transactionId][fileHash][requestedChunk]) {
            delete cachedData[transactionId][fileHash][requestedChunk];
        }
    }

    hasChunkToReceive(nodeId, transactionId, fileHash, requestedChunk) {
        const cachedData = cache.getCacheItem('storage-acl-receiver', nodeId);
        if (!cachedData) {
            return false;
        }
        return cachedData[transactionId] && cachedData[transactionId][fileHash] && cachedData[transactionId][fileHash][requestedChunk];
    }

}


export default new StorageAcl();
