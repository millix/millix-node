import WebSocket, {Server} from 'ws';
import path from 'path';
import os from 'os';
import configfrom '../config/config';
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

const WebSocketServer = Server;

class Receiver {
    constructor() {
        this.receiver_public = false;
        this.sender_public = false;
        this.num_active_receiver_servers = 0;
        this.num_active_sender_servers = 0;
        this.filesRootFolder = null;
    }

    initialize() {
        this.filesRootFolder = path.join(os.homedir(), config.FILES_CONNECTION.FOLDER);
        // to do: enviar mensagens para o pessoal para perceber se ha interessados em receber ficheiros e quais.
        this._startClient()
        this._startSever()
    }

    receiveAction(action){
        return new Promise((resolve, reject) => {
            this.receiver_public = action.receiver_public;
            this.sender_public = action.sender_public;

            if (this.receiver_public &&  this.sender_public){
                console.log("Both peers are private! Cannot communicate!");
                reject();
            }

            if (this.sender_public) {//Sender is public, receiver can be both
                this._startSenderServer();
            } else if (this.receiver_public) {//Sender is private and receiver is public
                this._startReceiverServer();
            }
            resolve();
        });
    }

    _startReceiverServer(){

        walletUtils.loadNodeKeyAndCertificate()
                   .then(({certificate_private_key_pem: certificatePrivateKeyPem, certificate_pem: certificatePem, node_private_key: nodePrivateKey, node_public_key: nodePublicKey}) => {
                       // starting the server
                       const httpsServer = https.createServer({
                           key      : certificatePrivateKeyPem,
                           cert     : certificatePem,
                           ecdhCurve: 'prime256v1'
                       }, app);

                       httpsServer.listen(config.NODE_PORT_API, config.NODE_BIND_IP, () => {
                           console.log(`[api] listening on port ${config.NODE_PORT_API}`);
                           this.nodeID         = walletUtils.getNodeIdFromCertificate(certificatePem, 'pem');
                           this.nodePrivateKey = nodePrivateKey;
                           console.log(`[api] node_id ${this.nodeID}`);
                           let nodeSignature = walletUtils.signMessage(nodePrivateKey, this.nodeID);
                           console.log(`[api] node_signature ${nodeSignature}`);
                           walletUtils.storeNodeData({
                               node_id       : this.nodeID,
                               node_signature: nodeSignature
                           }).then(_ => _).catch(_ => _);
                           const nodeRepository = database.getRepository('node');
                           const nop            = () => {
                           };
                           nodeRepository.addNodeAttribute(this.nodeID, 'node_public_key', base58.encode(nodePublicKey.toBuffer()))
                                         .then(nop)
                                         .catch(nop);
                       });
                       resolve();
                   });
    }

    _startSenderServer(){//not done
        const server = https.createServer({
            key      : certificatePrivateKeyPem,
            cert     : certificatePem,
            ecdhCurve: 'prime256v1'
        });

        server.listen(port, address);

        let wss = new WebSocketServer({server});

        this.setWebSocket(wss);





    }


}


export default new Receiver();
