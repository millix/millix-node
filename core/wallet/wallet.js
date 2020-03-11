import walletUtils from './wallet-utils';
import walletSync from './wallet-sync';
import walletTransactionConsensus from './wallet-transaction-consensus';
import database, {Database} from '../../database/database';
import eventBus from '../event-bus';
import signature from '../crypto/signature';
import objectHash from '../crypto/object-hash';
import readline from 'readline';
import Mnemonic from 'bitcore-mnemonic';
import peer from '../../net/peer';
import async from 'async';
import _ from 'lodash';
import genesisConfig from '../genesis/genesis-config';
import config from '../config/config';
import network from '../../net/network';
import mutex from '../mutex';
import ntp from '../ntp';

export const WALLET_MODE = {
    CONSOLE: 'CONSOLE',
    APP    : 'APP'
};


class Wallet {

    constructor() {
        this.mode                            = WALLET_MODE.CONSOLE;
        this._activeWallets                  = {};
        this._activeConsensusRound           = {};
        this._activeAuditPointUpdateRound    = {};
        this._transactionReceivedFromNetwork = {};
        this._transactionOnRoute             = {};
        this._transactionRequested           = {};
        this.defaultKeyIdentifier            = undefined;
        this._lockProcessNewTransaction      = 0;
        this._maxBacklogThresholdReached     = false;
    }

    get isProcessingNewTransactionFromNetwork() {
        return this._lockProcessNewTransaction <= 0;
    }

    lockProcessNewTransaction() {
        this._lockProcessNewTransaction++;
    }

    unlockProcessNewTransaction() {
        this._lockProcessNewTransaction--;
    }

    getActiveWalletKey(wallet) {
        return this._activeWallets[wallet];
    }

    getActiveWallets() {
        return this._activeWallets;
    }

    activateWallet(wallet, extPrivKey) {
        this._activeWallets[wallet] = extPrivKey;
    }

    deactivateAllWallets() {
        this._activeWallets = {};
    }

    isWalletActivated(wallet) {
        return !!this._activeWallets[wallet];
    }

    setMode(mode) {
        this.mode = mode;
        return this;
    }

    getWalletPassphrase(isNewMnemonic) {
        return new Promise((resolve) => {
            if (this.mode === WALLET_MODE.CONSOLE) {

                const rl = readline.createInterface({
                    input : process.stdin,
                    output: process.stdout
                });

                rl.question(
                    'Passphrase for the master key: ',
                    function(passphrase) {
                        rl.close();
                        if (process.stdout.moveCursor) {
                            process.stdout.moveCursor(0, -1);
                        }
                        if (process.stdout.clearLine) {
                            process.stdout.clearLine();
                        }

                        resolve(passphrase);
                    }
                );
            }
            else if (this.mode === WALLET_MODE.APP) {
                eventBus.once('wallet_key', resolve);
                eventBus.emit('wallet_ready', {create: isNewMnemonic});
            }
        });
    }

    createMnemonic() {
        const mnemonic = walletUtils.newMnemonic();
        return mnemonic.phrase;
    }

    getMnemonic() {
        return new Promise((resolve) => {
            walletUtils.loadMnemonic()
                       .then(([passphrase, isNewMnemonic]) => resolve([
                           passphrase,
                           isNewMnemonic
                       ]))
                       .catch(() => {
                           console.log('Creating new mnemonic');
                           let passphrase = this.createMnemonic();
                           resolve([
                               passphrase,
                               true
                           ]);
                       });
        });
    }

    deriveAddress(walletID, isChange, addressPosition) {
        if (this.isWalletActivated(walletID)) {
            const xPrivkey = this.getActiveWalletKey(walletID);
            if (xPrivkey) {
                return walletUtils.deriveAddressFromKey(xPrivkey, isChange, addressPosition);
            }
            else {
                throw Error('Should not call this method for inactive wallets');
            }
        }

        throw Error('Wallet not activated');
    }

    deriveAndSaveAddress(walletID, isChange, addressPosition) {
        const keychain = database.getRepository('keychain');
        return this.deriveAddress(walletID, isChange, addressPosition)
                   .then(([addressBase, addressAttribute]) => keychain.getWalletDefaultKeyIdentifier(walletID).then(addressKeyIdentifier => [
                       addressBase,
                       addressAttribute,
                       addressKeyIdentifier
                   ]))
                   .then(([addressBase, addressAttribute, addressKeyIdentifier]) => keychain.addAddress(walletID, isChange, addressPosition, addressBase, database.getRepository('address').getDefaultAddressVersion().version, addressKeyIdentifier || addressBase, addressAttribute));
    }

    addWallet(walletID, account) {
        return database.getRepository('wallet')
                       .addWallet(walletID, account)
                       .then(() => this.deriveAndSaveAddress(walletID, 0, 0))
                       .then(address => {
                           eventBus.emit('newAddress', address);
                           console.log('Primary address for wallet ' + walletID + ' is ' + address.address);
                           return address;
                       }).catch(() => Promise.resolve());
    }

    addNewAddress(walletID) {
        return database.getRepository('keychain').getNextAddressPosition(walletID)
                       .then((addressPosition) => this.deriveAndSaveAddress(walletID, 0, addressPosition))
                       .then(address => {
                           eventBus.emit('newAddress', address);
                           console.log('New address for wallet ' + walletID + ' is ' + address.address);
                           return address;
                       });
    }

    activateWalletByMasterKey(masterKey, createIfNotExists) {
        let account    = 0;
        let xPrivKey   = walletUtils.deriveExtendedPrivateKey(masterKey, account);
        const walletID = walletUtils.deriveWalletFromKey(xPrivKey);
        console.log('Try to unlock wallet:', walletID);
        return database.getRepository('wallet')
                       .walletExists(walletID)
                       .then(exists => {
                           if (exists === false) {
                               if (createIfNotExists) {
                                   this.deactivateAllWallets();
                                   this.activateWallet(walletID, xPrivKey);
                                   return this.addWallet(walletID, account)
                                              .then(() => {
                                                  eventBus.emit('wallet_unlock', walletID);
                                                  console.log('Wallet created and unlocked');
                                              })
                                              .then(() => walletID);
                               }
                               else {
                                   eventBus.emit('wallet_authentication_error');
                                   throw Error('wallet not found');
                               }
                           }
                           this.deactivateAllWallets();
                           this.activateWallet(walletID, xPrivKey);
                           eventBus.emit('wallet_unlock', walletID);
                           console.log('Wallet unlocked');
                           return walletID;
                       });
    }

    getWalletPrivateKey(mnemonicPhrase, isNewMnemonic) {
        return this.getWalletPassphrase(isNewMnemonic)
                   .then((passphrase) => {
                       const mnemonic = new Mnemonic(mnemonicPhrase);
                       return mnemonic.toHDPrivateKey(passphrase);
                   });
    }

    isCreateWallet(xPrivKey, isNewMnemonic) {
        return new Promise((resolve) => {
            if (isNewMnemonic) {
                return resolve([
                    xPrivKey,
                    isNewMnemonic
                ]);
            }
            else {
                database.getRepository('wallet')
                        .hasWallets()
                        .then(hasWallets => resolve([
                            xPrivKey,
                            !hasWallets || isNewMnemonic
                        ]));
            }
        });
    }

    addTransaction(srcAddress, dstOutputs, srcOutputs) {
        const transactionRepository = database.getRepository('transaction');
        const addressRepository     = database.getRepository('address');
        return new Promise((resolve, reject) => {
            mutex.lock(['write'], (unlock) => {
                let dbAddress;
                peer.getNodeAddress()
                    .then(node => database.getRepository('keychain')
                                          .getAddress(srcAddress)
                                          .then(address => [
                                              node.ip_address,
                                              address
                                          ]))
                    .then(([nodeIPAddress, address]) => ntp.getTime().then(time => [
                        nodeIPAddress,
                        new Date(Math.floor(time.now.getTime() / 1000) * 1000),
                        address
                    ]))
                    .then(([nodeIPAddress, timeNow, address]) => {
                        dbAddress   = address;
                        let privKey = this.getActiveWalletKey(dbAddress.wallet_id);
                        if (!privKey) {
                            return Promise.reject('wallet not active for address ' + srcAddress);
                        }
                        if (!srcOutputs) {
                            return transactionRepository.getFreeStableOutput(srcAddress)
                                                        .then(outputs => [
                                                            nodeIPAddress,
                                                            timeNow,
                                                            outputs
                                                        ]);
                        }
                        else {
                            return [
                                nodeIPAddress,
                                timeNow,
                                srcOutputs
                            ];
                        }
                    })
                    .then(([nodeIPAddress, timeNow, outputs]) => {
                        if (!outputs || outputs.length == 0) {
                            return Promise.reject('Do not have enough funds on address ' + srcAddress);
                        }
                        outputs = _.orderBy(outputs, ['amount'], ['desc']);

                        let outputsToUse    = [];
                        let amount          = _.sum(_.map(dstOutputs, o => o.amount));
                        let remainingAmount = amount;

                        let exactMatchOutput = _.find(outputs, o => o.amount == amount);
                        if (exactMatchOutput) {
                            remainingAmount                     = 0;
                            const outputAddress                 = addressRepository.getAddressComponent(exactMatchOutput.address);
                            exactMatchOutput['address_base']    = outputAddress['address'];
                            exactMatchOutput['address_version'] = outputAddress['version'];
                            outputsToUse.push(exactMatchOutput);
                        }
                        else {
                            for (let i = 0; i < outputs.length && remainingAmount > 0; i++) {
                                let output                = outputs[i];
                                remainingAmount -= output.amount;
                                const outputAddress       = addressRepository.getAddressComponent(output.address);
                                output['address_base']    = outputAddress['address'];
                                output['address_version'] = outputAddress['version'];
                                outputsToUse.push(output);
                            }
                        }

                        if (remainingAmount > 0) {
                            return Promise.reject('Do not have enough funds on address ' + srcAddress);
                        }

                        let keyMap         = {
                            'transaction_id'  : 'output_transaction_id',
                            'transaction_date': 'output_transaction_date',
                            'shard_id'        : 'output_shard_id'
                        };
                        let transaction    = {
                            transaction_input_list    : _.map(outputsToUse, o => _.mapKeys(_.pick(o, [
                                'transaction_id',
                                'output_position',
                                'transaction_date',
                                'shard_id',
                                'address_base',
                                'address_version',
                                'address_key_identifier'
                            ]), (v, k) => keyMap[k] ? keyMap[k] : k)),
                            transaction_output_list   : dstOutputs,
                            transaction_signature_list: [
                                {
                                    address_base     : dbAddress.address_base,
                                    address_attribute: dbAddress.address_attribute
                                }
                            ]
                        };
                        let amountSent     = _.sum(_.map(dstOutputs, o => o.amount));
                        let totalUsedCoins = _.sum(_.map(outputsToUse, o => o.amount));
                        let change         = totalUsedCoins - amountSent;
                        if (change > 0) {
                            transaction.transaction_output_list.push({
                                address_base          : dbAddress.address_base,
                                address_version       : dbAddress.address_version,
                                address_key_identifier: dbAddress.address_key_identifier,
                                amount                : change
                            });
                        }

                        return transactionRepository.getFreeTransactions()
                                                    .then(parents => {
                                                        if (!parents) {
                                                            throw Error('No parent available');
                                                        }

                                                        transaction['transaction_parent_list'] = _.map(parents, p => p.transaction_id).sort();
                                                        return [
                                                            transaction,
                                                            timeNow,
                                                            nodeIPAddress
                                                        ];
                                                    });
                    })
                    .then(([transaction, timeNow, nodeIPAddress]) => {
                        transaction.transaction_input_list.forEach((input, idx) => input['input_position'] = idx);
                        transaction.transaction_output_list.forEach((output, idx) => output['output_position'] = idx);
                        transaction['payload_hash']                            = objectHash.getCHash288(transaction);
                        transaction['transaction_date']                        = timeNow.toISOString();
                        transaction['node_id_origin']                          = network.nodeID;
                        transaction['shard_id']                                = genesisConfig.genesis_shard_id;
                        transaction['version']                                 = config.WALLET_TRANSACTION_DEFAULT_VERSION;
                        transaction.transaction_signature_list[0]['signature'] = this.sign(dbAddress, transaction);
                        transaction['transaction_id']                          = objectHash.getCHash288(transaction);
                        return transactionRepository.addTransactionFromObject(transaction);
                    })
                    .then((transaction) => {
                        return new Promise(resolve => {
                            async.eachSeries(transaction.transaction_output_list, (output, callback) => {
                                if (output.address_base === dbAddress.address_base) {
                                    transactionRepository.updateTransactionOutput(transaction.transaction_id, output.output_position, undefined, ntp.now(), undefined)
                                                         .then(callback);
                                }
                                else {
                                    callback();
                                }
                            }, () => resolve(transaction));
                        });
                    })
                    .then(transaction => peer.transactionSend(transaction))
                    .then((transaction) => {
                        resolve(transaction);
                        unlock();
                    })
                    .catch((e) => {
                        reject(e);
                        unlock();
                    });
            });
        });
    }

    sign(address, message) {
        const exPrivKey  = this.getActiveWalletKey(address.wallet_id);
        const privateKey = exPrivKey.derive(0, false).derive(address.address_position, false).privateKey;
        const privKeyBuf = privateKey.toBuffer({size: 32});
        return signature.sign(objectHash.getHashBuffer(message), privKeyBuf);
    }

    verify(publicKey, sign, message) {
        return signature.verify(objectHash.getHashBuffer(message), sign, publicKey);
    }

    isValidTransactionObject(transaction) {
        //sort arrays
        transaction['transaction_output_list'] = _.sortBy(transaction.transaction_output_list, 'output_position');
        transaction['transaction_input_list']  = _.sortBy(transaction.transaction_input_list, 'input_position');

        //verify addresses
        if (transaction.transaction_id !== genesisConfig.genesis_transaction) {
            for (let i = 0; i < transaction.transaction_input_list.length; i++) {
                if (!walletUtils.isValidAddress(transaction.transaction_input_list[i].address_base)
                    || !walletUtils.isValidAddress(transaction.transaction_input_list[i].address_key_identifier)) {
                    return false;
                }
            }
        }

        for (let i = 0; i < transaction.transaction_output_list.length; i++) {
            if (!walletUtils.isValidAddress(transaction.transaction_output_list[i].address_base)
                || !walletUtils.isValidAddress(transaction.transaction_output_list[i].address_key_identifier)) {
                return false;
            }

            try {
                let amount = Math.round(transaction.transaction_output_list[i].amount);
                if (amount <= 0 || amount !== transaction.transaction_output_list[i].amount) {
                    return false;
                }
            }
            catch (e) {
                return false;
            }
        }

        for (let i = 0; i < transaction.transaction_signature_list.length; i++) {
            if (!walletUtils.isValidAddress(transaction.transaction_signature_list[i].address_base)) {
                return false;
            }
        }


        // genesis transaction
        if (transaction.transaction_id === genesisConfig.genesis_transaction) {
            transaction['transaction_input_list']  = [
                {
                    type          : 'issue',
                    amount        : config.MILLIX_CIRCULATION,
                    input_position: 0
                }
            ];
            transaction['transaction_parent_list'] = [];
        }

        // verify signature
        let vTransaction = _.cloneDeep(_.omit(transaction, [
            'payload_hash',
            'transaction_id',
            'transaction_date',
            'node_id_origin',
            'shard_id',
            'version'
        ]));
        const sign       = vTransaction.transaction_signature_list[0]['signature'];
        delete vTransaction.transaction_signature_list[0]['signature'];
        if (transaction.transaction_id === genesisConfig.genesis_transaction) {
            delete vTransaction['transaction_parent_list'];
        }
        vTransaction['payload_hash']                            = objectHash.getCHash288(vTransaction);
        vTransaction['transaction_date']                        = transaction.transaction_date;
        vTransaction['node_id_origin']                          = transaction.node_id_origin;
        vTransaction['shard_id']                                = transaction.shard_id;
        vTransaction['version']                                 = transaction.version;
        const signatureVerified                                 = this.verify(vTransaction.transaction_signature_list[0].address_attribute.key_public, sign, vTransaction);
        vTransaction.transaction_signature_list[0]['signature'] = sign;
        vTransaction['transaction_id']                          = objectHash.getCHash288(vTransaction);

        if (signatureVerified === false || vTransaction['payload_hash'] != transaction['payload_hash'] || vTransaction['transaction_id'] !== transaction['transaction_id']) {
            return false;
        }

        return true;
    }


    verifyTransaction(transaction) {
        return new Promise(resolve => {

            if (transaction.transaction_id === genesisConfig.genesis_transaction) {
                return resolve(true);
            }

            if (!this.isValidTransactionObject(transaction)) {
                return resolve(false);
            }
            else {
                return resolve(true);
            }
        });
    }

    syncAddresses() {
        return new Promise(resolve => {
            mutex.lock(['sync-address-balance-request'], unlock => {
                let wallets = Object.keys(this.getActiveWallets());
                async.eachSeries(wallets, (walletID, callback) => {
                    database.getRepository('keychain').getWalletAddresses(walletID)
                            .then(addresses => {
                                async.eachSeries(addresses, (address, callbackAddress) => {
                                    database.getRepository('transaction')
                                            .getLastTransactionByAddress(address.address)
                                            .then(updated => peer.addressTransactionSync(address.address, updated ? updated.toISOString() : undefined))
                                            .then(() => callbackAddress());
                                }, () => callback());
                            });
                }, () => {
                    resolve();
                    unlock();
                });
            });
        });
    }

    _checkIfWalletUpdate(addressesList) {
        let walletID = this.getDefaultActiveWallet();
        database.getRepository('keychain').getWalletAddresses(this.getDefaultActiveWallet())
                .then(addresses => {
                    let diff = _.difference(addressesList, _.map(addresses, e => e.address));
                    if (diff.length !== addressesList.length) {
                        eventBus.emit('wallet_update', walletID);
                    }
                });
    }

    getAllTransactions() {
        let walletID = this.getDefaultActiveWallet();
        return database.getRepository('keychain')
                       .getWalletAddresses(walletID)
                       .then(addresses => {
                           let walletsAddresses     = _.map(addresses, address => address.address);
                           let addressKeyIdentifier = addresses.length > 0 ? addresses[0].address_key_identifier : undefined;
                           return [
                               walletsAddresses,
                               addressKeyIdentifier
                           ];
                       }).then(([addresses, addressKeyIdentifier]) => {
                addresses = new Set(addresses);
                return database.getRepository('transaction')
                               .getTransactionsByAddressKeyIdentifier(addressKeyIdentifier)
                               .then(transactions => {
                                   _.each(transactions, transaction => _.assign(transaction, {'income': addresses.has(transaction.output_address)}));
                                   return transactions;
                               });
            });
    }

    isProcessingTransaction(transactionID) {
        return this._transactionReceivedFromNetwork[transactionID] === true;
    }

    isRequestedTransaction(transactionID) {
        return !!this._transactionRequested[transactionID];
    }

    requestTransactionFromNetwork(transactionID) {
        peer.transactionSyncRequest(transactionID)
            .then(() => this._transactionRequested[transactionID] = Date.now())
            .catch(_ => _);
    }

    transactionHasKeyIdentifier(transaction) {
        for (let input of transaction.transaction_input_list) {
            if (input.address_key_identifier === this.defaultKeyIdentifier) {
                return true;
            }
        }
        for (let output of transaction.transaction_output_list) {
            if (output.address_key_identifier === this.defaultKeyIdentifier) {
                return true;
            }
        }
        return false;
    }

    getTransactionSyncPriority(transaction) {
        let isPriority = false;

        for (let i = 0; i < transaction.transaction_input_list.length && !isPriority; i++) {
            const input = transaction.transaction_input_list[i];
            if (input.address_key_identifier === this.defaultKeyIdentifier) {
                isPriority = true;
            }
        }

        for (let i = 0; i < transaction.transaction_output_list.length && !isPriority; i++) {
            const output = transaction.transaction_output_list[i];
            if (output.address_key_identifier === this.defaultKeyIdentifier) {
                isPriority = true;
            }
        }

        return isPriority ? 1 : 0;
    }

    _onNewTransaction(data, ws, isRequestedBySync) {

        let node         = ws.node;
        let connectionID = ws.connectionID;

        let transaction             = _.cloneDeep(data.transaction);
        let currentDepth            = data.depth || 0;
        const transactionRepository = database.getRepository('transaction');

        if (data.routing && data.routing_request_node_id !== network.nodeID) {
            eventBus.emit('transactionRoutingResponse:' + data.routing_request_node_id + ':' + transaction.transaction_id, data);
            if (!config.MODE_NODE_FULL) {
                delete this._transactionRequested[transaction.transaction_id];
                return;
            }
        }

        if (this._transactionReceivedFromNetwork[transaction.transaction_id]) {
            delete this._transactionRequested[transaction.transaction_id];
            return;
        }

        if (!this.isProcessingNewTransactionFromNetwork) {
            walletSync.add(transaction.transaction_id, {
                delay   : 5000,
                priority: this.getTransactionSyncPriority(transaction)
            });
            return;
        }

        this._transactionReceivedFromNetwork[transaction.transaction_id] = true;

        transactionRepository.hasTransaction(transaction.transaction_id)
                             .then(([hasTransaction, isAuditPoint, hasTransactionData]) => {
                                 if (hasTransaction && !(isAuditPoint && this.transactionHasKeyIdentifier(transaction))) {
                                     delete this._transactionReceivedFromNetwork[transaction.transaction_id];
                                     delete this._transactionRequested[transaction.transaction_id];
                                     return eventBus.emit('transaction_new:' + transaction.transaction_id);
                                 }

                                 return this.verifyTransaction(transaction, currentDepth)
                                            .then(validTransaction => {

                                                if (!validTransaction) {
                                                    console.log('Bad transaction object received from network');
                                                    eventBus.emit('badTransaction:' + transaction.transaction_id);
                                                    delete this._transactionReceivedFromNetwork[transaction.transaction_id];
                                                    delete this._transactionRequested[transaction.transaction_id];
                                                    return false;
                                                }

                                                let syncPriority = this.getTransactionSyncPriority(transaction);

                                                console.log('New Transaction from network ', transaction.transaction_id);
                                                return transactionRepository.addTransactionFromObject(transaction)
                                                                            .then(() => {
                                                                                console.log('[Wallet] Removing ', transaction.transaction_id, ' from network transaction cache');
                                                                                eventBus.emit('transaction_new:' + transaction.transaction_id);
                                                                                this._checkIfWalletUpdate(_.map(transaction.transaction_output_list, o => o.address_base + o.address_version + o.address_key_identifier));

                                                                                eventBus.emit('wallet_event_log', {
                                                                                    type   : 'transaction_new',
                                                                                    content: data,
                                                                                    from   : node
                                                                                });
                                                                                peer.transactionSpendRequest(transaction.transaction_id)
                                                                                    .then(response => {
                                                                                        _.each(response.transaction_id_list, spendTransactionID => {
                                                                                            if (!this._transactionReceivedFromNetwork[spendTransactionID]) {
                                                                                                transactionRepository.hasTransaction(spendTransactionID)
                                                                                                                     .then(([hasTransaction, isAuditPoint, hasTransactionData]) => {
                                                                                                                         if (!hasTransaction || isAuditPoint && this.transactionHasKeyIdentifier(transaction)) {
                                                                                                                             console.log('[Wallet] request sync transaction ', spendTransactionID, 'spending from', transaction.transaction_id);
                                                                                                                             peer.transactionSyncRequest(spendTransactionID, {priority: syncPriority})
                                                                                                                                 .then(() => this._transactionRequested[spendTransactionID] = Date.now())
                                                                                                                                 .catch(_ => _);
                                                                                                                         }
                                                                                                                     });
                                                                                            }
                                                                                        });
                                                                                    })
                                                                                    .catch(() => {
                                                                                    });

                                                                                if (transaction.transaction_id !== genesisConfig.genesis_transaction) {
                                                                                    _.each(transaction.transaction_input_list, inputTransaction => {
                                                                                        if (!this._transactionReceivedFromNetwork[inputTransaction.output_transaction_id]) {
                                                                                            transactionRepository.hasTransaction(inputTransaction.output_transaction_id)
                                                                                                                 .then(([hasTransaction, isAuditPoint, hasTransactionData]) => {
                                                                                                                     if (!hasTransaction || isAuditPoint && this.transactionHasKeyIdentifier(transaction)) {
                                                                                                                         console.log('[Wallet] request sync input transaction ', inputTransaction.output_transaction_id);
                                                                                                                         peer.transactionSyncRequest(inputTransaction.output_transaction_id, {priority: syncPriority})
                                                                                                                             .then(() => this._transactionRequested[inputTransaction.output_transaction_id] = Date.now())
                                                                                                                             .catch(_ => _);
                                                                                                                     }
                                                                                                                 });
                                                                                        }
                                                                                    });
                                                                                    _.each(transaction.transaction_parent_list, parentTransactionID => {
                                                                                        if (!this._transactionReceivedFromNetwork[parentTransactionID]) {
                                                                                            transactionRepository.hasTransaction(parentTransactionID)
                                                                                                                 .then(([hasTransaction, isAuditPoint, hasTransactionData]) => {
                                                                                                                     if (!hasTransaction || isAuditPoint && this.transactionHasKeyIdentifier(transaction)) {
                                                                                                                         console.log('[Wallet] request sync parent transaction ', parentTransactionID);
                                                                                                                         peer.transactionSyncRequest(parentTransactionID, {priority: syncPriority})
                                                                                                                             .then(() => this._transactionRequested[parentTransactionID] = Date.now())
                                                                                                                             .catch(_ => _);
                                                                                                                     }
                                                                                                                 });
                                                                                        }
                                                                                    });
                                                                                }
                                                                                if (!isRequestedBySync) {
                                                                                    let ws = network.getWebSocketByID(connectionID);
                                                                                    peer.transactionSend(transaction, ws);
                                                                                }
                                                                                delete this._transactionReceivedFromNetwork[transaction.transaction_id];
                                                                                delete this._transactionRequested[transaction.transaction_id];
                                                                            });
                                            });

                             })
                             .catch((err) => {
                                 console.log('[Wallet] cleanup dangling transaction ', transaction.transaction_id, '. [message]: ', err);
                                 delete this._transactionReceivedFromNetwork[transaction.transaction_id];
                                 delete this._transactionRequested[transaction.transaction_id];
                             });
    }

    _onSyncTransaction(data, ws) {

        if (data.routing) {
            if (!data.routing_request_node_id || data.routing_request_node_id === network.nodeID) { //no id or its my request
                return;
            }
            let requestNodeList = this._transactionOnRoute[data.routing_request_node_id];
            if (requestNodeList && requestNodeList[data.transaction_id]) { // its being processed
                return;
            }
        }

        let node                    = ws.node;
        let nodeID                  = ws.nodeID;
        let connectionID            = ws.connectionID;
        const transactionRepository = database.getRepository('transaction');

        eventBus.emit('wallet_event_log', {
            type   : 'transaction_sync',
            content: data,
            from   : node
        });
        transactionRepository.getTransactionObject(data.transaction_id)
                             .then(transaction => {
                                 if (transaction) {
                                     let ws = network.getWebSocketByID(connectionID);
                                     if (ws) {
                                         peer.transactionSyncResponse({
                                             transaction            : transactionRepository.normalizeTransactionObject(transaction),
                                             depth                  : data.depth,
                                             routing                : data.routing,
                                             routing_request_node_id: data.routing_request_node_id
                                         }, ws);
                                     }
                                 }
                                 else {
                                     mutex.lock(['routing_transaction'], unlock => {

                                         let requestNodeID = data.routing ? data.routing_request_node_id : nodeID;
                                         let transactionID = data.transaction_id;

                                         if (requestNodeID === undefined) {
                                             return unlock();
                                         }

                                         let requestNodeList = this._transactionOnRoute[requestNodeID];
                                         if (requestNodeList && requestNodeList[transactionID]) { // its being processed
                                             return unlock();
                                         }

                                         if (this._transactionOnRoute[requestNodeID]) {
                                             this._transactionOnRoute[requestNodeID][transactionID] = true;
                                         }
                                         else {
                                             this._transactionOnRoute[requestNodeID] = {
                                                 [transactionID]: true
                                             };
                                         }

                                         let self = this;
                                         eventBus.once('transactionRoutingResponse:' + requestNodeID + ':' + transactionID, function(routedData) {
                                             if (!self._transactionOnRoute[routedData.routing_request_node_id]) {
                                                 console.log('[Wallet] Routed package not requested ?!', routedData);
                                                 return;
                                             }

                                             delete self._transactionOnRoute[routedData.routing_request_node_id][routedData.transaction.transaction_id];

                                             if (!routedData.transaction) {
                                                 console.log('[Wallet] Routed package does not contain a transaction ?!', routedData);
                                                 return;
                                             }

                                             let ws = network.getWebSocketByID(connectionID);

                                             if (!ws || !ws.nodeID) {
                                                 console.log('[Wallet] Route destination not available', routedData);
                                                 return;
                                             }

                                             peer.transactionSyncResponse(routedData, ws);
                                         });

                                         setTimeout(function() {
                                             eventBus.removeAllListeners('transactionRoutingResponse:' + requestNodeID + ':' + transactionID);
                                         }, config.NETWORK_SHORT_TIME_WAIT_MAX);

                                         unlock();
                                         peer.transactionSyncRequest(transactionID, {
                                             depth          : data.depth,
                                             routing        : true,
                                             request_node_id: requestNodeID
                                         })
                                             .then(() => this._transactionRequested[transactionID] = Date.now())
                                             .catch(_ => _);
                                     }, undefined, Date.now() + config.NETWORK_LONG_TIME_WAIT_MAX);
                                 }
                             });
    }

    _onSyncAddressBalance(data, ws) {
        let node         = ws.node;
        let connectionID = ws.connectionID;
        mutex.lock(['sync-address-balance'], unlock => {
            let address = data.address;
            let updated = new Date(data.updated || 0);
            console.log('Transaction sync for address ', address, 'from', updated);
            eventBus.emit('wallet_event_log', {
                type   : 'address_transaction_sync',
                content: data,
                from   : node
            });
            const transactionRepository = database.getRepository('transaction');
            transactionRepository.getTransactionByOutputAddress(address, updated)
                                 .then(transactions => {
                                     console.log('>>', transactions.length, ' transaction will be synced to', address);
                                     async.eachSeries(transactions, (dbTransaction, callback) => {
                                         transactionRepository.getTransactionObject(dbTransaction.transaction_id)
                                                              .then(transaction => {
                                                                  let ws = network.getWebSocketByID(connectionID);
                                                                  if (transaction && ws) {
                                                                      peer.transactionSendToNode({transaction: transactionRepository.normalizeTransactionObject(transaction)}, ws);
                                                                  }
                                                                  callback();
                                                              });
                                     });
                                     unlock();
                                 }).catch(() => unlock());
        }, undefined, Date.now() + config.NETWORK_LONG_TIME_WAIT_MAX);
    }


    _onSyncTransactionSpendTransaction(data, ws) {
        let node         = ws.node;
        let connectionID = ws.connectionID;
        mutex.lock(['sync-transaction-spend'], unlock => {
            eventBus.emit('wallet_event_log', {
                type   : 'transaction_spend_request',
                content: data,
                from   : node
            });
            let transactionID = data.transaction_id;
            database.getRepository('transaction')
                    .getSpendTransactions(transactionID)
                    .then(transactions => {
                        if (transactions.length === 0) {
                            unlock();
                            return;
                        }

                        transactions = _.map(transactions, transaction => transaction.transaction_id);
                        let ws       = network.getWebSocketByID(connectionID);
                        peer.transactionSpendResponse(transactionID, transactions, ws);
                        unlock();
                    }).catch(() => unlock());
        }, undefined, Date.now() + config.NETWORK_LONG_TIME_WAIT_MAX);
    }

    _onTransactionIncludePathRequest(data, ws) {
        let node         = ws.node;
        let connectionID = ws.connectionID;
        eventBus.emit('wallet_event_log', {
            type   : 'transaction_include_path_request',
            content: data,
            from   : node
        });
        mutex.lock(['transaction-include-path'], unlock => {
            let transactionID          = data.transaction_id;
            let maxDepth               = data.depth;
            let excludeTransactionList = data.transaction_id_exclude_list || [];
            database.getRepository('transaction')
                    .getTransactionIncludePaths(transactionID, maxDepth)
                    .then(paths => {
                        let maxLength = _.reduce(paths, (max, path) => path.length > max ? path.length : max, 0);
                        let path      = _.find(paths, path => path.length === maxLength);
                        path          = _.difference(path, excludeTransactionList);
                        let ws        = network.getWebSocketByID(connectionID);
                        if (path.length > 0 && ws) {
                            peer.transactionIncludePathResponse({
                                transaction_id     : transactionID,
                                transaction_id_list: path
                            }, ws);
                        }
                        unlock();
                    });
        }, undefined, Date.now() + config.NETWORK_LONG_TIME_WAIT_MAX);
    }


    getDefaultActiveWallet() {
        return Object.keys(this.getActiveWallets())[0];
    }

    _doDAGProgress() {
        return new Promise(resolve => {
            database.getRepository('keychain').getWalletAddresses(this.getDefaultActiveWallet())
                    .then((addresses) => {
                        let address = _.sample(addresses);
                        this.addTransaction(address.address, [
                            {
                                address_base          : address.address_base,
                                address_version       : address.address_version,
                                address_key_identifier: address.address_key_identifier,
                                amount                : 1
                            }
                        ])
                            .then(transaction => {
                                const transactionRepository = database.getRepository('transaction');
                                return transactionRepository.setTransactionAsStable(transaction.transaction_id)
                                                            .then(() => transactionRepository.setOutputAsStable(transaction.transaction_id))
                                                            .then(() => transactionRepository.setInputsAsSpend(transaction.transaction_id))
                                                            .then(() => resolve());
                            }).catch(() => resolve());
                    });
        });
    }

    _onTransactionIncludePathResponse(data, ws) {
        eventBus.emit('wallet_event_log', {
            type   : 'transaction_include_path_response',
            content: data,
            from   : ws.node
        });
        let path = data.transaction_id_list;
        async.eachSeries(path, (transactionID, callback) => {
            if (!this._transactionReceivedFromNetwork[transactionID] && !this._transactionRequested[transactionID]) {
                database.getRepository('transaction')
                        .hasTransaction(transactionID)
                        .then(([hasTransaction, isAuditPoint, hasTransactionData]) => {
                            if (hasTransactionData) {
                                return callback();
                            }

                            (() => {
                                if (isAuditPoint) {
                                    return database.getRepository('audit_point')
                                                   .deleteAuditPoint(transactionID);
                                }
                                else {
                                    return Promise.resolve();
                                }
                            })().then(() => {
                                peer.transactionSyncRequest(transactionID, {priority: 2})
                                    .then(() => this._transactionRequested[transactionID] = Date.now())
                                    .catch(_ => _);
                            });

                            callback();
                        });
            }
        });

    }

    getWalletAddresses() {
        return database.getRepository('keychain').getWalletAddresses(this.getDefaultActiveWallet());
    }

    _doSyncTransactionIncludePath() {
        const transactionRepository = database.getRepository('transaction');
        return new Promise(resolve => {
            database.getRepository('keychain')
                    .getWalletAddresses(this.getDefaultActiveWallet())
                    .then(addresses => database.getRepository('address')
                                               .getAddressesUnstableTransactions(addresses.map(address => address.address), 0, Array.from(walletTransactionConsensus.getRejectedTransactionList().keys())))
                    .then(pendingTransactions => {
                        async.eachSeries(pendingTransactions, (pendingTransaction, callback) => {
                            transactionRepository.getTransactionIncludePaths(pendingTransaction.transaction_id)
                                                 .then(paths => {
                                                     let maxLength = _.reduce(paths, (max, path) => path.length > max ? path.length : max, 0);
                                                     if (maxLength >= config.CONSENSUS_ROUND_PATH_LENGTH_MIN) {
                                                         return callback(); //dont
                                                                            // need
                                                                            // to
                                                                            // sync
                                                                            // more
                                                                            // transactions
                                                     }

                                                     let transactions = _.find(paths, path => path.length === maxLength);

                                                     if (maxLength <= 1) {
                                                         transactionRepository.getTransactionObject(pendingTransaction.transaction_id)
                                                                              .then(dbTransaction => {
                                                                                  peer.transactionSend(transactionRepository.normalizeTransactionObject(dbTransaction));
                                                                                  peer.transactionIncludePathRequest(pendingTransaction.transaction_id, transactions)
                                                                                      .then(([response, ws]) => {
                                                                                          this._onTransactionIncludePathResponse(response, ws);
                                                                                      })
                                                                                      .catch(() => {
                                                                                      });
                                                                                  callback();
                                                                              });
                                                     }
                                                     else {
                                                         peer.transactionIncludePathRequest(pendingTransaction.transaction_id, transactions)
                                                             .then(([response, ws]) => {
                                                                 this._onTransactionIncludePathResponse(response, ws);
                                                             })
                                                             .catch(() => {
                                                             });
                                                         callback();
                                                     }
                                                 }).catch(() => callback());
                        }, () => resolve());
                    }).catch(() => resolve());
        });
    }

    _doAuditPointUpdate() {
        let self = this;

        return new Promise(resolve => {

            if (_.keys(this._activeAuditPointUpdateRound).length > 0) {
                console.log('[audit point] A audit-point update round is running', this._activeAuditPointUpdateRound);
                return resolve();
            }

            let auditPointID                                          = Database.generateID(20);
            this._activeAuditPointUpdateRound[auditPointID]           = {};
            this._activeAuditPointUpdateRound[auditPointID].timestamp = new Date().getTime();
            this._activeAuditPointUpdateRound[auditPointID].resolve   = resolve;

            const auditPoint        = database.getRepository('audit_point');
            const auditVerification = database.getRepository('audit_verification');
            auditPoint.getAuditPointCandidateTransactions()
                      .then(pendingAuditPointTransactions => {
                          if (!pendingAuditPointTransactions || pendingAuditPointTransactions.length === 0) {
                              console.log('No transactions to add to audit point available.');
                              delete this._activeAuditPointUpdateRound[auditPointID];
                              return resolve();
                          }

                          console.log('[audit point] audit round for ', auditPointID, ' with ', pendingAuditPointTransactions.length, ' transactions');

                          walletTransactionConsensus._selectNodesForConsensusRound()
                                                    .then(selectedNodeList => {
                                                        if (selectedNodeList.length !== config.AUDIT_POINT_NODE_COUNT || !self._activeAuditPointUpdateRound[auditPointID]) {
                                                            console.log('[audit point] No node ready for this audit round');
                                                            delete this._activeAuditPointUpdateRound[auditPointID];
                                                            return resolve();
                                                        }

                                                        self._activeAuditPointUpdateRound[auditPointID].nodes = {};

                                                        eventBus.on('audit_point_validation_response:' + auditPointID, (data, ws) => {
                                                            if (!self._activeAuditPointUpdateRound[auditPointID]) {
                                                                eventBus.removeAllListeners('audit_point_validation_response:' + auditPointID);
                                                                return resolve();
                                                            }
                                                            else if (!self._activeAuditPointUpdateRound[auditPointID].nodes[ws.node] || self._activeAuditPointUpdateRound[auditPointID].nodes[ws.node].replied) {
                                                                return;
                                                            }

                                                            console.log('[audit point] Received reply for audit round', auditPointID, ' from ', ws.node, ' with ', data.transaction_id_list.length, ' validated out of ', pendingAuditPointTransactions.length);

                                                            self._activeAuditPointUpdateRound[auditPointID].nodes[ws.node]['transactions'] = data.transaction_id_list;
                                                            self._activeAuditPointUpdateRound[auditPointID].nodes[ws.node]['replied']      = true;

                                                            // check if done
                                                            for (let wsNode of _.keys(self._activeAuditPointUpdateRound[auditPointID].nodes)) {
                                                                if (self._activeAuditPointUpdateRound[auditPointID].nodes[wsNode].replied === false) {
                                                                    return; //stop
                                                                            // here
                                                                }
                                                            }

                                                            self._activeAuditPointUpdateRound[auditPointID].updatingDB = true;

                                                            // here we have all
                                                            // replies

                                                            console.log('[audit point] audit round ', auditPointID, ' is being processed');

                                                            let newTransactions           = [];
                                                            let updateTransactions        = [];
                                                            let newAuditPointTransactions = [];


                                                            // check if done
                                                            async.eachSeries(Array.from(new Set(pendingAuditPointTransactions)), (pendingTransaction, callback) => {

                                                                if (!self._activeAuditPointUpdateRound[auditPointID]) {
                                                                    return callback();
                                                                }

                                                                let validationCount = 0;
                                                                for (let wsNode of _.keys(self._activeAuditPointUpdateRound[auditPointID].nodes)) {
                                                                    if (_.includes(self._activeAuditPointUpdateRound[auditPointID].nodes[wsNode].transactions, pendingTransaction)) {
                                                                        validationCount += 1;
                                                                    }
                                                                }
                                                                let validated = validationCount >= 2 / 3 * config.AUDIT_POINT_NODE_COUNT;

                                                                auditVerification.getAuditVerification(pendingTransaction)
                                                                                 .then(auditVerification => {

                                                                                     let newInfo = false;
                                                                                     if (!auditVerification) {
                                                                                         auditVerification = {
                                                                                             verification_count: 0,
                                                                                             attempt_count     : 0,
                                                                                             verified_date     : null,
                                                                                             transaction_id    : pendingTransaction
                                                                                         };
                                                                                         newInfo           = true;
                                                                                     }

                                                                                     if (auditVerification.is_verified && auditVerification.is_verified === 1) {
                                                                                         return callback();
                                                                                     }

                                                                                     if (validated) {
                                                                                         auditVerification.verification_count++;
                                                                                         auditVerification.attempt_count++;
                                                                                         if (auditVerification.verification_count >= config.AUDIT_POINT_VALIDATION_REQUIRED) {
                                                                                             newInfo ? newTransactions.push([
                                                                                                         auditVerification.transaction_id,
                                                                                                         auditVerification.verification_count,
                                                                                                         auditVerification.attempt_count,
                                                                                                         ntp.now()
                                                                                                     ])
                                                                                                     : updateTransactions.push([
                                                                                                         auditVerification.verification_count,
                                                                                                         auditVerification.attempt_count,
                                                                                                         ntp.now(),
                                                                                                         1,
                                                                                                         auditVerification.transaction_id
                                                                                                     ]);
                                                                                             newAuditPointTransactions.push([
                                                                                                 auditPointID,
                                                                                                 auditVerification.transaction_id
                                                                                             ]);
                                                                                         }
                                                                                         else {
                                                                                             newInfo ? newTransactions.push([
                                                                                                         auditVerification.transaction_id,
                                                                                                         auditVerification.verification_count,
                                                                                                         auditVerification.attempt_count,
                                                                                                         null
                                                                                                     ])
                                                                                                     : updateTransactions.push([
                                                                                                         auditVerification.verification_count,
                                                                                                         auditVerification.attempt_count,
                                                                                                         null,
                                                                                                         0,
                                                                                                         auditVerification.transaction_id
                                                                                                     ]);
                                                                                         }
                                                                                     }
                                                                                     else {
                                                                                         auditVerification.attempt_count++;
                                                                                         newInfo ? newTransactions.push([
                                                                                                     auditVerification.transaction_id,
                                                                                                     auditVerification.verification_count,
                                                                                                     auditVerification.attempt_count,
                                                                                                     null
                                                                                                 ])
                                                                                                 : updateTransactions.push([
                                                                                                     auditVerification.verification_count,
                                                                                                     auditVerification.attempt_count,
                                                                                                     null,
                                                                                                     0,
                                                                                                     auditVerification.transaction_id
                                                                                                 ]);
                                                                                     }

                                                                                     callback();

                                                                                 });
                                                            }, () => {

                                                                console.log('[audit point] audit round ', auditPointID, ' add ', newTransactions.length, ' audit verifications');
                                                                auditVerification.addAuditVerification(newTransactions)
                                                                                 .then(() => {
                                                                                     console.log('[audit point] audit round ', auditPointID, ' update ', updateTransactions.length, ' audit verifications');
                                                                                     return auditVerification.updateAuditVerification(updateTransactions);
                                                                                 })
                                                                                 .then(() => {
                                                                                     console.log('[audit point] audit round ', auditPointID, '  add ', newAuditPointTransactions.length, ' transactions to audit point');
                                                                                     return auditPoint.addTransactionToAuditPoint(newAuditPointTransactions);
                                                                                 })
                                                                                 .then(() => {
                                                                                     eventBus.removeAllListeners('audit_point_validation_response:' + auditPointID);
                                                                                     delete self._activeAuditPointUpdateRound[auditPointID];
                                                                                     console.log('[audit point] audit round ', auditPointID, ' finished after receiving all replies');
                                                                                     resolve();
                                                                                 }).catch((err) => {
                                                                    eventBus.removeAllListeners('audit_point_validation_response:' + auditPointID);
                                                                    delete self._activeAuditPointUpdateRound[auditPointID];
                                                                    console.log('[audit point] Error on audit round ', auditPointID, '. [message]: ', err);
                                                                    resolve();
                                                                });
                                                            });

                                                        });

                                                        _.each(selectedNodeList, ws => {
                                                            console.log('[audit point] Ask ', ws.node, ' for audit point validation');
                                                            self._activeAuditPointUpdateRound[auditPointID].nodes[ws.node] = {replied: false};
                                                            peer.auditPointValidationRequest({
                                                                audit_point_id     : auditPointID,
                                                                transaction_id_list: pendingAuditPointTransactions
                                                            }, ws);
                                                        });
                                                    });

                      });
        });

    }

    _onTransactionValidationRequest(data, ws) {
        walletTransactionConsensus.validateTransactionInConsensusRound(data, ws);
    }

    _doAuditPointWatchDog() {
        let auditPointID = Object.keys(this._activeAuditPointUpdateRound)[0];
        if (auditPointID && (new Date().getTime() - this._activeAuditPointUpdateRound[auditPointID].timestamp) >= config.AUDIT_POINT_VALIDATION_WAIT_TIME_MAX) {
            if (this._activeAuditPointUpdateRound[auditPointID].updatingDB) {
                console.log('[audit point] validation not killed by watch dog because db is being updated... ', auditPointID);
                return;
            }

            console.log('[audit point] validation killed by watch dog ', auditPointID);
            eventBus.removeAllListeners('audit_point_validation_response:' + auditPointID);

            if (this._activeAuditPointUpdateRound[auditPointID].resolve) {
                this._activeAuditPointUpdateRound[auditPointID].resolve();
            }

            delete this._activeAuditPointUpdateRound[auditPointID];
        }
        return Promise.resolve();
    }

    _onAuditPointValidationRequest(data, ws) {
        let connectionID = ws.connectionID;
        mutex.lock(['audit-point-validation-request'], unlock => {
            let transactions = data.transaction_id_list;
            let auditPointID = data.audit_point_id;
            database.getRepository('audit_point')
                    .getValidAuditPoints(transactions)
                    .then(validAuditPoints => {
                        let ws = network.getWebSocketByID(connectionID);
                        if (ws) {
                            peer.auditPointValidationResponse(_.map(validAuditPoints, transactions => transactions.transaction_id), auditPointID, ws);
                        }
                        unlock();
                    });
        }, undefined, Date.now() + config.AUDIT_POINT_VALIDATION_WAIT_TIME_MAX);
    }

    _doTransactionSetForPruning() {
        return new Promise(resolve => {
            mutex.lock(['transaction-set-pruning'], unlock => {
                database.getRepository('audit_point').updateTransactionToPrune(this.defaultKeyIdentifier)
                        .then(() => {
                            unlock();
                            resolve();
                        });
            });
        });
    }

    _doTransactionPruning() {

        if (mutex.getKeyQueuedSize(['transaction-pruning']) > 0) { // a prune task is running.
            return Promise.resolve();
        }

        return new Promise(resolve => {
            mutex.lock(['transaction-pruning'], unlock => {
                this.lockProcessNewTransaction();
                database.getRepository('audit_point')
                        .pruneTransaction()
                        .then(() => {
                            unlock();
                            resolve();
                            this.unlockProcessNewTransaction();
                        })
                        .catch(() => {
                            unlock();
                            resolve();
                            this.unlockProcessNewTransaction();
                        });
            });
        });
    }

    _doAuditPointPruning() {
        return new Promise(resolve => {
            mutex.lock(['audit-point-pruning'], unlock => {
                database.getRepository('audit_point')
                        .pruneAuditPoint()
                        .then(() => {
                            unlock();
                            resolve();
                        })
                        .catch(() => {
                            unlock();
                            resolve();
                        });
            });
        });
    }

    _doSyncBalanceForAddresses() {
        return this.syncAddresses();
    }

    _doStateInspector() {
        let networkTransactions = _.keys(this._transactionReceivedFromNetwork);
        console.log('_transactionReceivedFromNetwork:', networkTransactions.length, ' | _transactionValidationRejected:', walletTransactionConsensus.getRejectedTransactionList().size, ' | _activeConsensusRound:', _.keys(this._activeConsensusRound).length);

        if (!this._maxBacklogThresholdReached && mutex.getKeyQueuedSize(['transaction']) >= config.WALLET_TRANSACTION_QUEUE_SIZE_MAX) {
            this._maxBacklogThresholdReached = true;
            this.lockProcessNewTransaction();
        }
        else if (this._maxBacklogThresholdReached && mutex.getKeyQueuedSize(['transaction']) <= config.WALLET_TRANSACTION_QUEUE_SIZE_MAX) {
            this._maxBacklogThresholdReached = false;
            this.unlockProcessNewTransaction();
        }

        return Promise.resolve();
    }

    _doUpdateRetryTransactionValidation() {
        let now                    = Date.now();
        const retryTransactionList = walletTransactionConsensus.getRetryTransactionList();
        _.each(_.keys(retryTransactionList), transactionID => {
            if (retryTransactionList[transactionID] < now - config.CONSENSUS_VALIDATION_RETRY_WAIT_TIME) {
                walletTransactionConsensus.removeFromRejectedTransactions(transactionID);
                walletTransactionConsensus.removeFromRetryTransactions(transactionID);
                delete this._transactionRequested[transactionID];
                console.log('[wallet] set transaction ', transactionID, ' ready to retry validation.');
            }
        });

        _.each(_.keys(this._transactionRequested), transactionID => {
            if (this._transactionRequested[transactionID] < now - config.CONSENSUS_VALIDATION_RETRY_WAIT_TIME) {
                delete this._transactionRequested[transactionID];
            }
        });

        return Promise.resolve();
    }


    _initializeEvents() {
        walletSync.initialize()
                  .then(() => walletTransactionConsensus.initialize())
                  .then(() => {
                      eventBus.on('transaction_new', this._onNewTransaction.bind(this));
                      eventBus.on('transaction_sync', this._onSyncTransaction.bind(this));
                      eventBus.on('address_transaction_sync', this._onSyncAddressBalance.bind(this));
                      eventBus.on('transaction_validation_request', this._onTransactionValidationRequest.bind(this));
                      eventBus.on('transaction_include_path_request', this._onTransactionIncludePathRequest.bind(this));
                      eventBus.on('transaction_spend_request', this._onSyncTransactionSpendTransaction.bind(this));
                      eventBus.on('audit_point_validation_request', this._onAuditPointValidationRequest.bind(this));
                  });
    }

    initialize(initializeEventsOnly) {
        if (!initializeEventsOnly) {
            return this.getMnemonic()
                       .then(([mnemonicPhrase, isNewMnemonic]) =>
                           this.getWalletPrivateKey(mnemonicPhrase, isNewMnemonic).then(xPrivkey => [
                               xPrivkey,
                               isNewMnemonic
                           ])
                               .then(([xPrivkey, isNewMnemonic]) => this.isCreateWallet(xPrivkey, isNewMnemonic))
                               .then(([xPrivkey, isCreated]) => this.activateWalletByMasterKey(xPrivkey, isCreated))
                               .then((walletID) => {
                                   if (isNewMnemonic) {
                                       return walletUtils.storeMnemonic(mnemonicPhrase).then(() => walletID);
                                   }
                                   else {
                                       return Promise.resolve(walletID);
                                   }
                               })
                       )
                       .then(walletID => {
                           this._initializeEvents();
                           return database.getRepository('keychain').getWalletDefaultKeyIdentifier(walletID)
                                          .then(defaultKeyIdentifier => {
                                              this.defaultKeyIdentifier = defaultKeyIdentifier;
                                              return walletID;
                                          });
                       })
                       .catch((err) => {
                           console.log(err);
                           throw Error('Could not initialize wallet');
                       });
        }
        else {
            this._initializeEvents();
            return Promise.resolve(this.getDefaultActiveWallet());
        }
    }

    stopTasks() {
        walletSync.close().then(_ => _).catch(_ => _);
        eventBus.removeAllListeners('transaction_new');
        eventBus.removeAllListeners('transaction_sync');
        eventBus.removeAllListeners('address_transaction_sync');
        eventBus.removeAllListeners('transaction_validation_request');
        eventBus.removeAllListeners('transaction_include_path_request');
        eventBus.removeAllListeners('transaction_spend_request');
        eventBus.removeAllListeners('audit_point_validation_request');
    }
}


export default new Wallet();
