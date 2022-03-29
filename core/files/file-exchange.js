import WebSocket, {Server} from 'ws';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import wallet from '../wallet/wallet';
import mutex from '../mutex';
import console from '../console';
import database from '../../database/database';
import config, {NODE_BIND_IP} from '../config/config';
import https from 'https';
import walletUtils from '../wallet/wallet-utils';
import base58 from 'bs58';
import sender from './sender';

const WebSocketServer = Server;

/**
 * Open server to listen what to do
 * Receives message to send:
 *      * Args:
 *          - Destination (address and port)
 *          - chunk (optional?)
 *      * Return:
 *          - 1 it: num of Chunks
 *          - then: chunks
 * */

class FileExchange {
    constructor() {
        this.filesRootFolder = null;
        this.walletKeyIdentifier = null;
    }

    initialize() {
        this.filesRootFolder = path.join(os.homedir(), config.FILES_CONNECTION.FOLDER);
        if (!fs.existsSync(this.filesRootFolder)) {
            fs.mkdirSync(path.join(this.filesRootFolder));
        }
        this.walletKeyIdentifier = wallet.getKeyIdentifier();
        this._startServiceForMessageExchange();
    }

    _startServiceForMessageExchange(){
        // message exchange protocol here
    }

    exchange(){
        //where i will call this?
        //to do: Exchange of messages to decide if the node is interested in receiving the file.
        let senderAddress = sender.getAddress();
        //Expected format
        const transactionToExchange = {
            wallet:"muo5n6eDKj2t9BhdXZWBkEed75zi4ZkMqY",
            transaction:"123transaction321",
            files:[
                {
                    name:"transactionAttributes.json",
                    chunks:1
                },
                {
                    name:"c93e8a5a2d7c11998bccc1d0fa55e2b5fdfaeaa18a2e439bb199b3b5f2b700fd",
                    chunks:1
                },
                {
                    name:"7cb3a19fc765cf66287c372aa7c5979495e15c56afc1c1ef4cdfc448cb220561",
                    chunks:1
                }
            ]
        };
    }

}


export default new FileExchange();
