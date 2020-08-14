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
import path from 'path';
import console from '../console';

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
        this.initialized                     = false;
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

                console.disable();
                rl.question(
                    isNewMnemonic ? 'enter a passphrase to protect this wallet: ' : 'enter the passphrase to unlock this wallet: ',
                    function(passphrase) {
                        rl.close();
                        if (process.stdout.moveCursor) {
                            process.stdout.moveCursor(0, -1);
                        }
                        if (process.stdout.clearLine) {
                            process.stdout.clearLine();
                        }

                        console.enable();
                        resolve(passphrase);
                    }
                );
            }
            eventBus.removeAllListeners('wallet_key');
            eventBus.once('wallet_key', resolve);
            eventBus.emit('wallet_ready', {create: isNewMnemonic});
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
        const keychain                                                  = database.getRepository('keychain');
        let {address: addressBase, address_attribute: addressAttribute} = this.deriveAddress(walletID, isChange, addressPosition);
        return keychain.getWalletDefaultKeyIdentifier(walletID)
                       .then(addressKeyIdentifier => [
                           addressBase,
                           addressAttribute,
                           addressKeyIdentifier
                       ])
                       .then(([addressBase, addressAttribute, addressKeyIdentifier]) =>
                           keychain.addAddress(walletID, isChange, addressPosition, addressBase,
                               database.getRepository('address').getDefaultAddressVersion().version,
                               addressKeyIdentifier || addressBase, addressAttribute));
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
        const addressRepository = database.getRepository('address');
        return new Promise((resolve, reject) => {
            mutex.lock(['write'], (unlock) => {
                database.getRepository('keychain')
                        .getAddress(srcAddress)
                        .then(address => {
                            let privKey = this.getActiveWalletKey(address.wallet_id);
                            if (!privKey) {
                                return Promise.reject('wallet not active for address ' + srcAddress);
                            }
                            if (!srcOutputs) {
                                return database.firstShards((shardID) => {
                                    const transactionRepository = database.getRepository('transaction', shardID);
                                    return new Promise((resolve, reject) => transactionRepository.getFreeStableOutput(srcAddress)
                                                                                                 .then(outputs => outputs.length ? resolve(outputs) : reject()));
                                }).then(outputs => [
                                    outputs,
                                    address
                                ]);
                            }
                            else {
                                return [
                                    srcOutputs,
                                    address
                                ];
                            }
                        })
                        .then(([outputs, address]) => {
                            if (!outputs || outputs.length === 0) {
                                return Promise.reject('Do not have enough funds on address ' + srcAddress);
                            }
                            outputs = _.orderBy(outputs, ['amount'], ['desc']);

                            let outputsToUse    = [];
                            let amount          = _.sum(_.map(dstOutputs, o => o.amount));
                            let remainingAmount = amount;

                            let exactMatchOutput = _.find(outputs, o => o.amount === amount);
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

                            let keyMap      = {
                                'transaction_id'  : 'output_transaction_id',
                                'transaction_date': 'output_transaction_date',
                                'shard_id'        : 'output_shard_id'
                            };
                            const srcInputs = _.map(outputsToUse, o => _.mapKeys(_.pick(o, [
                                'transaction_id',
                                'output_position',
                                'transaction_date',
                                'shard_id',
                                'address_base',
                                'address_version',
                                'address_key_identifier'
                            ]), (v, k) => keyMap[k] ? keyMap[k] : k));

                            let amountSent     = _.sum(_.map(dstOutputs, o => o.amount));
                            let totalUsedCoins = _.sum(_.map(outputsToUse, o => o.amount));
                            let change         = totalUsedCoins - amountSent;
                            if (change > 0) {
                                dstOutputs.push({
                                    address_base          : address.address_base,
                                    address_version       : address.address_version,
                                    address_key_identifier: address.address_key_identifier,
                                    amount                : change
                                });
                            }
                            const extendedPrivateKey = this.getActiveWalletKey(address.wallet_id);
                            const privateKeyBuf      = walletUtils.derivePrivateKey(extendedPrivateKey, 0, address.address_position);
                            const privateKeyMap      = {[address.address_base]: privateKeyBuf.toString('hex')};
                            const addressBases       = [address.address_base];
                            return this.signAndStoreTransaction(srcInputs, dstOutputs, addressBases, privateKeyMap, config.WALLET_TRANSACTION_DEFAULT_VERSION);
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
        const extendedPrivateKey = this.getActiveWalletKey(address.wallet_id);
        const privateKeyBuf      = walletUtils.derivePrivateKey(extendedPrivateKey, 0, address.address_position);
        return signature.sign(objectHash.getHashBuffer(message), privateKeyBuf);
    }

    syncAddresses(ws) {
        return new Promise(resolve => {
            mutex.lock(['sync-address-balance-request'], unlock => {
                let wallets = Object.keys(this.getActiveWallets());
                async.eachSeries(wallets, (walletID, callback) => {
                    database.getRepository('keychain').getWalletAddresses(walletID)
                            .then(addresses => {
                                async.eachSeries(addresses, (address, callbackAddress) => {
                                    database.applyShards((shardID) => {
                                        return database.getRepository('transaction', shardID)
                                                       .getLastTransactionByAddress(address.address);
                                    }).then(lastUpdateByShard => _.max(lastUpdateByShard))
                                            .then(updated => peer.addressTransactionSync(address.address, updated ? updated.toISOString() : undefined, ws))
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

    syncShardIfNotExists(transaction, ws) {
        if (!database.shardExists(transaction.shard_id)) {
            return peer.shardSync(transaction.shard_id, ws)
                       .then(shardInfo => {
                           const shardRepository    = database.getRepository('shard');
                           const nodeRepository     = database.getRepository('node');
                           shardInfo['shard_name']  = shardInfo.shard_id + '.sqlite';
                           shardInfo['schema_path'] = path.join(database.getRootFolder(), 'shard/');
                           return shardRepository.addShard(shardInfo.shard_id, shardInfo.shard_name, shardInfo.shard_type,
                               shardInfo.shard_name, shardInfo.schema_path, false, shardInfo.node_id_origin, shardInfo.shard_date, shardInfo.node_signature)
                                                 .then(() => database.addKnownShard(shardInfo.shard_id))
                                                 .then(() => nodeRepository.getNodeAttribute(network.nodeID, 'shard_' + shardInfo.shard_type))
                                                 .then((shardAttributeList) => new Promise(resolve => {
                                                     shardAttributeList = shardAttributeList ? JSON.parse(shardAttributeList) : [];
                                                     nodeRepository.addNodeAttribute(network.nodeID, 'shard_' + shardInfo.shard_type, JSON.stringify([
                                                         ...shardAttributeList,
                                                         {
                                                             'shard_id'            : shardInfo.shard_id,
                                                             'transaction_count'   : 0,
                                                             'update_date'         : Math.floor(ntp.now().getTime() / 1000),
                                                             'is_required'         : false,
                                                             'fee_ask_request_byte': 20
                                                         }
                                                     ])).then(() => resolve()).catch(() => resolve());
                                                 }));
                       });
        }
        else {
            return Promise.resolve();
        }
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
                return database.applyShards((shardID) => {
                    return database.getRepository('transaction', shardID)
                                   .getTransactionsByAddressKeyIdentifier(addressKeyIdentifier);
                }, 'transaction_date desc').then(transactions => {
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

    transactionSpendRequest(transactionID, hasKeyIdentifier, priority) {
        return new Promise((resolve, reject) => {
            peer.transactionSpendRequest(transactionID)
                .then(response => {
                    async.eachSeries(response.transaction_id_list, (spendTransactionID, callback) => {
                        if (!this._transactionReceivedFromNetwork[spendTransactionID]) {
                            database.firstShards((shardID) => {
                                const transactionRepository = database.getRepository('transaction', shardID);
                                return new Promise((resolve, reject) => transactionRepository.hasTransaction(spendTransactionID)
                                                                                             .then(([hasTransaction, isAuditPoint, hasTransactionData]) => hasTransaction || isAuditPoint ? resolve([
                                                                                                 hasTransaction,
                                                                                                 isAuditPoint,
                                                                                                 hasTransactionData
                                                                                             ]) : reject()));
                            }).then(data => data || []).then(([hasTransaction, isAuditPoint, hasTransactionData]) => {
                                if (!hasTransaction || isAuditPoint && hasKeyIdentifier) {
                                    console.log('[Wallet] request sync transaction ', spendTransactionID, 'spending from', transactionID);
                                    peer.transactionSyncRequest(spendTransactionID, {priority})
                                        .then(() => {
                                            this._transactionRequested[spendTransactionID] = Date.now();
                                            callback();
                                        })
                                        .catch(_ => callback());
                                }
                                else {
                                    callback();
                                }
                            });
                        }
                        else {
                            callback();
                        }
                    }, () => resolve());
                })
                .catch(() => {
                    reject();
                });
        });
    }

    getConsensus() {
        return walletTransactionConsensus;
    }

    resetTransactionValidationRejected() {
        walletTransactionConsensus.resetTransactionValidationRejected();
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

    _onSyncShard(data, ws) {
        const shardRepository = database.getRepository('shard');
        shardRepository.getShard({shard_id: data.shard_id})
                       .then(shardInfo => peer.shardSyncResponse(shardInfo, ws));
    }


    _onTransactionSyncByDateResponse(data, ws) {
        if (eventBus.listenerCount('transaction_sync_by_date_response:' + ws.nodeID) > 0) {
            eventBus.emit('transaction_sync_by_date_response:' + ws.nodeID, data);
        }
        else {
            walletSync.moveProgressiveSync(ws);
        }
    }

    _onTransactionSyncResponse(data, ws) {
        if (data && data.transaction) {
            eventBus.emit('transaction_sync_response:' + data.transaction.transaction_id, {transaction_not_found: data.transaction_not_found});
            if (!data.transaction_not_found) {
                setTimeout(() => this._onNewTransaction(data, ws, true), 0);
            }
        }
    }

    _onSyncOutputSpendTransactionResponse(data, ws) {
        eventBus.emit(`transaction_output_spend_response:${data.transaction_id}_${data.output_position}`, data);
        if (data.transaction_list) {
            data.transaction_list.forEach(transaction => setTimeout(() => this._onNewTransaction({transaction}, ws, true), 0));
        }
    }

    _onNewTransaction(data, ws, isRequestedBySync) {

        let node         = ws.node;
        let connectionID = ws.connectionID;

        let transaction = _.cloneDeep(data.transaction);

        if (data.routing && data.routing_request_node_id !== network.nodeID) {
            eventBus.emit('transactionRoutingResponse:' + data.routing_request_node_id + ':' + transaction.transaction_id, data);
        }

        if (!transaction || data.transaction_not_found) {
            return;
        }
        else if (this._transactionReceivedFromNetwork[transaction.transaction_id]) {
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
        return this.syncShardIfNotExists(transaction, ws)
                   .then(() => {
                       // check if the transaction is in the shard zero
                       const shardZeroTransactionRepository = database.getRepository('transaction'); // shard zero
                       return shardZeroTransactionRepository.hasTransaction(transaction.transaction_id)
                                                            .then(([hasTransaction, isAuditPoint, hasTransactionData]) => {
                                                                const transactionRepository = database.getRepository('transaction', transaction.shard_id);
                                                                if (!hasTransaction && !isAuditPoint && transactionRepository) { // if not in the shard zero, check if it's in it's default shard
                                                                    return transactionRepository.hasTransaction(transaction.transaction_id);
                                                                }
                                                                else {
                                                                    return [
                                                                        hasTransaction,
                                                                        isAuditPoint,
                                                                        hasTransactionData
                                                                    ];
                                                                }
                                                            })
                                                            .then(([hasTransaction, isAuditPoint, hasTransactionData]) => {

                                                                if (hasTransaction && !(isAuditPoint && !hasTransactionData && this.transactionHasKeyIdentifier(transaction))) {
                                                                    delete this._transactionReceivedFromNetwork[transaction.transaction_id];
                                                                    delete this._transactionRequested[transaction.transaction_id];
                                                                    return eventBus.emit('transaction_new:' + transaction.transaction_id);
                                                                }

                                                                return walletUtils.verifyTransaction(transaction)
                                                                                  .then(validTransaction => {

                                                                                      if (!validTransaction) {
                                                                                          console.log('Invalid transaction received from network. Setting all of the childs to invalid');

                                                                                          this.findAndSetAllSpendersAsInvalid(transaction)
                                                                                              .then(_ => _)
                                                                                              .catch(err => console.log(`Failed to find and set spenders as invalid. Error: ${err}`));

                                                                                          eventBus.emit('badTransaction:' + transaction.transaction_id);
                                                                                          delete this._transactionReceivedFromNetwork[transaction.transaction_id];
                                                                                          delete this._transactionRequested[transaction.transaction_id];
                                                                                          return false;
                                                                                      }

                                                                                      let syncPriority     = this.getTransactionSyncPriority(transaction);
                                                                                      let hasKeyIdentifier = this.transactionHasKeyIdentifier(transaction);
                                                                                      if (syncPriority === 1) {
                                                                                          console.log('[wallet-key-identifier] ', transaction);
                                                                                      }

                                                                                      let transactionRepository = shardZeroTransactionRepository;
                                                                                      if (new Date(transaction.transaction_date).getTime() <= (Date.now() - config.TRANSACTION_PRUNE_AGE_MIN * 60000)) {
                                                                                          let shardTransactionRepository = database.getRepository('transaction', transaction.shard_id);
                                                                                          if (shardTransactionRepository || hasKeyIdentifier) {
                                                                                              transactionRepository = shardTransactionRepository || transactionRepository;
                                                                                          }
                                                                                          else {
                                                                                              delete this._transactionReceivedFromNetwork[transaction.transaction_id];
                                                                                              delete this._transactionRequested[transaction.transaction_id];
                                                                                              return Promise.resolve();
                                                                                          }
                                                                                      }

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

                                                                                                                      this.transactionSpendRequest(transaction.transaction_id, hasKeyIdentifier, syncPriority).then(_ => _).catch(_ => _);
                                                                                                                      walletSync.syncTransactionSpendingOutputs(transaction);

                                                                                                                      if (transaction.transaction_id !== genesisConfig.genesis_transaction) {
                                                                                                                          _.each(transaction.transaction_input_list, inputTransaction => {
                                                                                                                              if (!this._transactionReceivedFromNetwork[inputTransaction.output_transaction_id]) {
                                                                                                                                  database.firstShards((shardID) => {
                                                                                                                                      const transactionRepository = database.getRepository('transaction', shardID);
                                                                                                                                      return new Promise((resolve, reject) => transactionRepository.hasTransaction(inputTransaction.output_transaction_id)
                                                                                                                                                                                                   .then(([hasTransaction, isAuditPoint, hasTransactionData]) => hasTransaction || isAuditPoint ? resolve([
                                                                                                                                                                                                       hasTransaction,
                                                                                                                                                                                                       isAuditPoint,
                                                                                                                                                                                                       hasTransactionData
                                                                                                                                                                                                   ]) : reject()));
                                                                                                                                  }).then(data => data || []).then(([hasTransaction, isAuditPoint, hasTransactionData]) => {
                                                                                                                                      if (!hasTransaction || isAuditPoint && hasKeyIdentifier) {
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
                                                                                                                                  database.firstShards((shardID) => {
                                                                                                                                      const transactionRepository = database.getRepository('transaction', shardID);
                                                                                                                                      return new Promise((resolve, reject) => transactionRepository.hasTransaction(parentTransactionID)
                                                                                                                                                                                                   .then(([hasTransaction, isAuditPoint, hasTransactionData]) => hasTransaction || isAuditPoint ? resolve([
                                                                                                                                                                                                       hasTransaction,
                                                                                                                                                                                                       isAuditPoint,
                                                                                                                                                                                                       hasTransactionData
                                                                                                                                                                                                   ]) : reject()));
                                                                                                                                  }).then(data => data || []).then(([hasTransaction, isAuditPoint, hasTransactionData]) => {
                                                                                                                                      if (!hasTransaction || isAuditPoint && hasKeyIdentifier) {
                                                                                                                                          console.log('[Wallet] request sync parent transaction ', parentTransactionID);
                                                                                                                                          peer.transactionSyncRequest(parentTransactionID, {priority: syncPriority})
                                                                                                                                              .then(() => this._transactionRequested[parentTransactionID] = Date.now())
                                                                                                                                              .catch(_ => _);
                                                                                                                                      }
                                                                                                                                  });
                                                                                                                              }
                                                                                                                          });
                                                                                                                      }
                                                                                                                      if (!isRequestedBySync || hasKeyIdentifier) {
                                                                                                                          let ws = network.getWebSocketByID(connectionID);
                                                                                                                          peer.transactionSend(transaction, ws);
                                                                                                                      }
                                                                                                                      delete this._transactionReceivedFromNetwork[transaction.transaction_id];
                                                                                                                      delete this._transactionRequested[transaction.transaction_id];
                                                                                                                  });
                                                                                  });

                                                            });
                   })
                   .catch((err) => {
                       console.log('[Wallet] cleanup dangling transaction ', transaction.transaction_id, '. [message]: ', err);
                       delete this._transactionReceivedFromNetwork[transaction.transaction_id];
                       delete this._transactionRequested[transaction.transaction_id];
                   });
    }

    // Once a transaction is determined as invalid, we want to set all its
    // spenders (if there are any) as invalid.
    findAndSetAllSpendersAsInvalid(transaction) {
        return new Promise((resolve, reject) => {
            this.findAllSpenders(transaction)
                .then((allSpenders) => {
                    console.log(`Found ${allSpenders.length} spenders of invalid transaction ${transaction.transaction_id}`);

                    this.markAllSpendersAsInvalid(allSpenders)
                        .then(() => {
                            console.log(`Marked all spenders of ${transaction.transaction_id} as invalid`);
                            resolve();
                        })
                        .catch((err) => reject(err));
                })
                .catch((err) => reject(err));
        });
    }

    // Finds all spenders of a single transaction
    // This is a recursive function
    // The spenders are added to an array that is passed in
    findAllSpenders(transaction) {
        console.log(`[Wallet] Querying all shards for potential spenders of transaction ${transaction.transaction_id}`);

        return new Promise((resolve) => {
            return database.applyShards((shardID) => {
                return new Promise(resolve => {
                    database.getRepository('transaction', shardID)
                            .getTransactionSpenders(transaction.transaction_id)
                            .then(result => resolve(result))
                            .catch(err => {
                                console.log(`[wallet] Error occurred: ${err}`);
                                resolve([]);
                            });
                });
            }).then(transactionSpenders => {
                if (transactionSpenders.length === 0) {
                    return resolve([transaction]);
                } // stops recursion

                async.mapSeries(transactionSpenders, (spender, callback) => {
                    // continues recursion
                    this.findAllSpenders(spender)
                        .then((spenders) => callback(false, spenders));
                }, (err, mapOfSpenders) => {
                    let spenders = Array.prototype.concat.apply([], mapOfSpenders);
                    spenders.push(transaction);
                    resolve(spenders);
                });
            });
        });
    }

    markAllSpendersAsInvalid(spenders) {
        let spendersByShard = {};

        for (let spender of spenders) {
            if (!(spender.shard_id in spendersByShard)) {
                spendersByShard[spender.shard_id] = [];
            }

            spendersByShard[spender.shard_id].push(spender.transaction_id);
        }

        return new Promise((resolve) => {
            async.eachSeries(Object.entries(spendersByShard), ([shardID, transactionIDs], callback) => {
                console.log(`[Wallet] Marking transactions ${transactionIDs.join(', ')} on shard ${shardID} as invalid.`);

                database.getRepository('transaction', shardID)
                        .markTransactionsAsInvalid(transactionIDs)
                        .then(() => {
                            console.log(`Set transactions ${transactionIDs} as invalid`);
                            callback();
                        })
                        .catch((err) => {
                            console.log(`Error while marking transactions as invalid: ${err}`);
                            callback();
                        });
            }, () => {
                console.log('Finished setting all spenders as invalid');
                resolve();
            });
        });
    }

    _onSyncTransactionByDate(data, ws) {
        let node         = ws.node;
        let connectionID = ws.connectionID;
        const start      = Date.now();
        mutex.lock(['sync-transaction'], unlock => {
            eventBus.emit('wallet_event_log', {
                type   : 'transaction_sync_by_date',
                content: data,
                from   : node
            });

            const beginTimestamp         = data.begin_timestamp;
            const endTimestamp           = data.end_timestamp;
            const excludeTransactionList = data.exclude_transaction_id_list;

            database.applyShards((shardID) => {
                const transactionRepository = database.getRepository('transaction', shardID);
                return transactionRepository.listTransactions({
                    transaction_date_end  : endTimestamp,
                    transaction_date_begin: beginTimestamp
                });
            }).then(transactionsByDate => {
                // let's exclude the list of tx already present in our
                // peer.
                let transactions = new Set(_.map(transactions, transaction => transaction.transaction_id));
                excludeTransactionList.forEach(transactionID => transactions.delete(transactionID));
                transactionsByDate = _.filter(transactionsByDate, transactionID => transactions.has(transactionID));
                transactions       = Array.from(transactions);

                // get peers' current web socket
                let ws = network.getWebSocketByID(connectionID);
                peer.transactionSyncByDateResponse(transactions, ws);
                console.log(`[wallet] sending transactions sync by date to node ${ws.nodeID} (response time: ${Date.now() - start}ms)`);
                // unlock here. now on we are going to send missing
                // transactions to peer.
                unlock();

                if (transactionsByDate.length === 0) { // no transaction will be synced
                    return;
                }

                // get transaction objects
                async.mapSeries(transactionsByDate, (transaction, callback) => {
                    database.firstShardZeroORShardRepository('transaction', transaction.shard_id, transactionRepository => {
                        return new Promise((resolve, reject) => {
                            transactionRepository.getTransactionObject(transaction.transaction_id)
                                                 .then(transaction => transaction ? resolve(transactionRepository.normalizeTransactionObject(transaction)) : reject())
                                                 .catch(() => reject());
                        });
                    }).then(transaction => callback(null, transaction));
                }, (err, transactions) => {
                    async.eachSeries(transactions, (transaction, callback) => {
                        // get peers' current web socket
                        let ws = network.getWebSocketByID(connectionID);
                        peer.transactionSendToNode(transaction, ws);
                        setTimeout(() => callback(), 250);
                    });
                });

            }).catch(() => unlock());
        });
    }

    _onSyncTransaction(data, ws) {
        const startTimestamp = Date.now();
        if (data.routing) {
            if (!data.routing_request_node_id || data.routing_request_node_id === network.nodeID) { //no id or its my request
                return;
            }
            let requestNodeList = this._transactionOnRoute[data.routing_request_node_id];
            if (requestNodeList && requestNodeList[data.transaction_id]) { // its being processed
                return;
            }
        }

        let node         = ws.node;
        let nodeID       = ws.nodeID;
        let connectionID = ws.connectionID;

        eventBus.emit('wallet_event_log', {
            type   : 'transaction_sync',
            content: data,
            from   : node
        });
        database.firstShards((shardID) => {
            return new Promise((resolve, reject) => {
                const transactionRepository = database.getRepository('transaction', shardID);
                transactionRepository.getTransactionObject(data.transaction_id)
                                     .then(transaction => transaction ? resolve([
                                         transaction,
                                         transactionRepository
                                     ]) : reject())
                                     .catch(() => reject());
            });
        }).then(firstShardData => {
            const [transaction, transactionRepository] = firstShardData || [];
            if (transaction) {
                let ws = network.getWebSocketByID(connectionID);
                if (ws) {
                    try {
                        peer.transactionSyncResponse({
                            transaction            : transactionRepository.normalizeTransactionObject(transaction),
                            depth                  : data.depth,
                            routing                : data.routing,
                            routing_request_node_id: data.routing_request_node_id
                        }, ws);
                        console.log(`[wallet] sending transaction ${data.transaction_id} to node ${ws.nodeID} (response time: ${Date.now() - startTimestamp}ms)`);
                    }
                    catch (e) {
                        console.log('[wallet] error sending transaction sync response. transaction normalization issue. ' + e.message);
                    }
                }
            }
            else {
                console.log(`[wallet] sending transaction ${data.transaction_id} not found to node ${ws.nodeID} (response time: ${Date.now() - startTimestamp}ms)`);
                peer.transactionSyncResponse({
                    transaction            : {transaction_id: data.transaction_id},
                    transaction_not_found  : true,
                    depth                  : data.depth,
                    routing                : data.routing,
                    routing_request_node_id: data.routing_request_node_id
                }, ws);

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

                    eventBus.removeAllListeners('transactionRoutingResponse:' + requestNodeID + ':' + transactionID);
                    eventBus.once('transactionRoutingResponse:' + requestNodeID + ':' + transactionID, (routedData) => {
                        if (!this._transactionOnRoute[routedData.routing_request_node_id]) {
                            console.log('[Wallet] Routed package not requested ?!', routedData);
                            return;
                        }

                        delete this._transactionOnRoute[routedData.routing_request_node_id][routedData.transaction.transaction_id];

                        if (!routedData.transaction) {
                            console.log('[Wallet] Routed package does not contain a transaction ?!', routedData);
                            return;
                        }

                        let ws = network.getWebSocketByID(connectionID);

                        if (!ws || !ws.nodeID) {
                            console.log('[Wallet] Route destination not available', routedData);
                            return;
                        }

                        peer.transactionSendToNode(routedData.transaction, ws);
                        console.log(`[wallet] sending transaction ${data.transaction_id} to node ${ws.nodeID} (response time: ${Date.now() - startTimestamp}ms)`);
                    });

                    setTimeout(function() {
                        eventBus.removeAllListeners('transactionRoutingResponse:' + requestNodeID + ':' + transactionID);
                    }, config.NETWORK_SHORT_TIME_WAIT_MAX);

                    unlock();
                    peer.transactionSyncRequest(transactionID, {
                        depth           : data.depth,
                        routing         : true,
                        request_node_id : requestNodeID,
                        dispatch_request: true
                    })
                        .then(_ => _)
                        .catch(_ => _);
                    this._transactionRequested[transactionID] = Date.now();
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
            console.log('[wallet] transaction sync for address ', address, 'from', updated);
            eventBus.emit('wallet_event_log', {
                type   : 'address_transaction_sync',
                content: data,
                from   : node
            });
            database.applyShards((shardID) => {
                const transactionRepository = database.getRepository('transaction', shardID);
                return transactionRepository.getTransactionByOutputAddress(address, updated);
            }).then(transactions => {
                console.log('[wallet] >>', transactions.length, ' transaction will be synced to', address);
                async.eachSeries(transactions, (dbTransaction, callback) => {
                    database.firstShardZeroORShardRepository('transaction', dbTransaction.shard_id, transactionRepository => {
                        return new Promise((resolve, reject) => {
                            transactionRepository.getTransactionObject(dbTransaction.transaction_id)
                                                 .then(transaction => transaction ? resolve([
                                                     transaction,
                                                     transactionRepository
                                                 ]) : reject())
                                                 .catch(() => reject());
                        });
                    }).then(data => data || []).then(([transaction, transactionRepository]) => {
                        let ws = network.getWebSocketByID(connectionID);
                        if (transaction && ws) {
                            peer.transactionSendToNode(transactionRepository.normalizeTransactionObject(transaction), ws);
                        }
                        callback();
                    });
                });
                unlock();
            }).catch(() => unlock());
        }, undefined, Date.now() + config.NETWORK_LONG_TIME_WAIT_MAX);
    }


    _onSyncTransactionSpendTransaction(data, ws) {
        let node             = ws.node;
        let connectionID     = ws.connectionID;
        const startTimestamp = Date.now();
        mutex.lock(['sync-transaction-spend'], unlock => {
            eventBus.emit('wallet_event_log', {
                type   : 'transaction_spend_request',
                content: data,
                from   : node
            });
            let transactionID = data.transaction_id;
            database.applyShards((shardID) => {
                const transactionRepository = database.getRepository('transaction', shardID);
                return transactionRepository.getSpendTransactions(transactionID);
            }).then(transactions => {
                if (transactions && transactions.length > 0) {
                    transactions = _.uniq(_.map(transactions, transaction => transaction.transaction_id));
                }
                else {
                    transactions = [];
                }

                let ws = network.getWebSocketByID(connectionID);
                peer.transactionSpendResponse(transactionID, transactions, ws);
                console.log(`[wallet] sending transactions spending from tx: ${data.transaction_id} to node ${ws.nodeID} (response time: ${Date.now() - startTimestamp}ms)`);
                unlock();
            }).catch(() => unlock());
        }, undefined, Date.now() + config.NETWORK_LONG_TIME_WAIT_MAX);
    }

    _onSyncOutputSpendTransaction(data, ws) {
        let node             = ws.node;
        let connectionID     = ws.connectionID;
        const startTimestamp = Date.now();
        mutex.lock(['sync-transaction-spend'], unlock => {
            eventBus.emit('wallet_event_log', {
                type   : 'transaction_output_spend_request',
                content: data,
                from   : node
            });

            const transactionID             = data.transaction_id;
            const transactionOutputPosition = data.output_position;

            database.applyShards((shardID) => {
                const transactionRepository = database.getRepository('transaction', shardID);
                return transactionRepository.listTransactionInput({
                    output_transaction_id: transactionID,
                    output_position      : transactionOutputPosition
                });
            }).then(spendingTransactions => {
                // get transaction objects
                async.mapSeries(spendingTransactions, (spendingTransaction, callback) => {
                    database.firstShardZeroORShardRepository('transaction', spendingTransaction.shard_id, transactionRepository => {
                        return new Promise((resolve, reject) => {
                            transactionRepository.getTransactionObject(spendingTransaction.transaction_id)
                                                 .then(transaction => transaction ? resolve(transactionRepository.normalizeTransactionObject(transaction)) : reject())
                                                 .catch(() => reject());
                        });
                    }).then(transaction => callback(null, transaction));
                }, (err, transactions) => {
                    // get peers' current web socket
                    let ws = network.getWebSocketByID(connectionID);
                    peer.transactionOutputSpendResponse(transactionID, transactionOutputPosition, transactions, ws);
                    console.log(`[wallet] sending transactions spending from output tx: ${data.transaction_id}:${data.output_position} to node ${ws.nodeID} (response time: ${Date.now() - startTimestamp}ms)`);
                    unlock();
                });
            }).catch(() => unlock());
        });
    }

    _onTransactionIncludePathRequest(data, ws) {
        let node             = ws.node;
        let connectionID     = ws.connectionID;
        const startTimestamp = Date.now();
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
                        console.log(`[wallet] sending transaction include path to tx: ${data.transaction_id} to node ${ws.nodeID} (response time: ${Date.now() - startTimestamp}ms)`);
                        unlock();
                    });
        }, undefined, Date.now() + config.NETWORK_LONG_TIME_WAIT_MAX);
    }


    getDefaultActiveWallet() {
        return Object.keys(this.getActiveWallets())[0];
    }

    _doUpdateNodeAttribute() {
        const nodeRepository = database.getRepository('node');
        let jobRepository    = database.getRepository('job');
        return new Promise(resolve => {
            const shardRepository = database.getRepository('shard');
            let totalTransactions = 0;
            shardRepository.listShard()
                           .then(shardList => {
                               return new Promise(resolve => {
                                   const shardAttributeList = [];
                                   async.eachSeries(shardList, (shard, callback) => {
                                       database.getRepository('transaction', shard.shard_id)
                                               .getTransactionCount()
                                               .then(count => {
                                                   totalTransactions += count;
                                                   shardAttributeList.push({
                                                       'shard_id'            : shard.shard_id,
                                                       'transaction_count'   : count,
                                                       'update_date'         : Math.floor(ntp.now().getTime() / 1000),
                                                       'is_required'         : !!shard.is_required,
                                                       'fee_ask_request_byte': 20
                                                   });
                                                   callback();
                                               });
                                   }, () => nodeRepository.addNodeAttribute(network.nodeID, 'shard_protocol', JSON.stringify(shardAttributeList)).then(resolve));
                               });
                           })
                           .then(() => nodeRepository.addNodeAttribute(network.nodeID, 'transaction_count', totalTransactions))
                           .then(resolve).catch(resolve);
        }).then(() => jobRepository.getJobs()
                                   .then(jobs => {
                                       return nodeRepository.addNodeAttribute(network.nodeID, 'job_list', JSON.stringify(_.map(jobs, job => ({
                                           job_name: job.job_name,
                                           status  : job.status
                                       }))));
                                   }));// update job attribute
    }

    _doDAGProgress() {
        return new Promise(resolve => {
            database.getRepository('keychain').getWalletAddresses(this.getDefaultActiveWallet())
                    .then((addresses) => {
                        let address = _.sample(addresses);
                        if (!address) {
                            return resolve();
                        }
                        this.addTransaction(address.address, [
                            {
                                address_base          : address.address_base,
                                address_version       : address.address_version,
                                address_key_identifier: address.address_key_identifier,
                                amount                : 1
                            }
                        ]).then((transaction) => {
                            this._checkIfWalletUpdate(_.map(transaction.transaction_output_list, o => o.address_base + o.address_version + o.address_key_identifier));
                            resolve();
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
                database.firstShards((shardID) => {
                    const transactionRepository = database.getRepository('transaction', shardID);
                    return new Promise((resolve, reject) => transactionRepository.hasTransaction(transactionID)
                                                                                 .then(([hasTransaction, isAuditPoint, hasTransactionData]) => hasTransaction || isAuditPoint ? resolve([
                                                                                     hasTransaction,
                                                                                     isAuditPoint,
                                                                                     hasTransactionData,
                                                                                     shardID
                                                                                 ]) : reject()));
                }).then(data => data || []).then(([hasTransaction, isAuditPoint, hasTransactionData, shardID]) => {
                    if (hasTransactionData) {
                        return callback();
                    }

                    (() => {
                        if (isAuditPoint) {
                            return database.getRepository('audit_point', shardID)
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

    // TODO - check
    _doSyncTransactionIncludePath() {
        return new Promise(resolve => {
            database.getRepository('keychain')
                    .getWalletAddresses(this.getDefaultActiveWallet())
                    .then(addresses => {
                        return database.applyShards((shardID) => {
                            return database.getRepository('transaction', shardID)
                                           .getAddressesUnstableTransactions(addresses.map(address => address.address), 0, Array.from(walletTransactionConsensus.getRejectedTransactionList().keys()));
                        });
                    })
                    .then(pendingTransactions => {
                        async.eachSeries(pendingTransactions, (pendingTransaction, callback) => {
                            const transactionRepository = database.getRepository('transaction'); // shard zero
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
                                                                              .then(dbTransaction => dbTransaction ? dbTransaction : database.getRepository('transaction', pendingTransaction.shard_id)
                                                                                                                                             .getTransactionObject(pendingTransaction.transaction_id))
                                                                              .then(dbTransaction => {
                                                                                  peer.transactionSend(transactionRepository.normalizeTransactionObject(dbTransaction));
                                                                                  peer.transactionIncludePathRequest(pendingTransaction.transaction_id, transactions)
                                                                                      .then(([response, ws]) => {
                                                                                          this._onTransactionIncludePathResponse(response, ws);
                                                                                      })
                                                                                      .catch(_ => _);
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
            const pendingAuditPointTransactions                       = [];
            database.firstShards((shardID) => {
                return new Promise((resolve, reject) => {
                    const auditPoint = database.getRepository('audit_point', shardID);
                    auditPoint.getAuditPointCandidateTransactions()
                              .then(pending => {
                                  if (pending && pending.length > 0) {
                                      for (let i = 0; i < pending.length && pendingAuditPointTransactions.length < config.AUDIT_POINT_CANDIDATE_MAX; i++) {
                                          pendingAuditPointTransactions.push({
                                              transaction: pending[i],
                                              shard_id   : shardID
                                          });
                                      }

                                      if (pendingAuditPointTransactions.length >= config.AUDIT_POINT_CANDIDATE_MAX) {
                                          return resolve();
                                      }
                                  }
                                  reject();
                              });
                });
            }).then(() => {
                if (pendingAuditPointTransactions.length === 0) {
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

                                                  let newTransactions           = {};
                                                  let updateTransactions        = {};
                                                  let newAuditPointTransactions = {};


                                                  // check if done
                                                  async.eachSeries(Array.from(new Set(pendingAuditPointTransactions)), (data, callback) => {
                                                      const pendingTransaction = data.transaction;
                                                      const shardID            = data.shard_id;
                                                      const auditVerification  = database.getRepository('audit_verification', shardID);

                                                      if (!newTransactions[shardID]) {
                                                          newTransactions[shardID] = [];
                                                      }

                                                      if (!updateTransactions[shardID]) {
                                                          updateTransactions[shardID] = [];
                                                      }

                                                      if (!newAuditPointTransactions[shardID]) {
                                                          newAuditPointTransactions[shardID] = [];
                                                      }

                                                      if (!self._activeAuditPointUpdateRound[auditPointID]) {
                                                          return callback();
                                                      }

                                                      let validationCount = 0;
                                                      for (let wsNode of _.keys(self._activeAuditPointUpdateRound[auditPointID].nodes)) {
                                                          if (_.includes(self._activeAuditPointUpdateRound[auditPointID].nodes[wsNode].transactions, pendingTransaction.transaction_id)) {
                                                              validationCount += 1;
                                                          }
                                                      }
                                                      let validated = validationCount >= 2 / 3 * config.AUDIT_POINT_NODE_COUNT;
                                                      auditVerification.getAuditVerification(pendingTransaction.transaction_id)
                                                                       .then(auditVerification => {

                                                                           let newInfo = false;
                                                                           if (!auditVerification) {
                                                                               auditVerification = {
                                                                                   verification_count: 0,
                                                                                   attempt_count     : 0,
                                                                                   verified_date     : null,
                                                                                   transaction_id    : pendingTransaction.transaction_id,
                                                                                   shard_id          : pendingTransaction.shard_id
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
                                                                                   newInfo ? newTransactions[shardID].push([
                                                                                               auditVerification.transaction_id,
                                                                                               auditVerification.verification_count,
                                                                                               auditVerification.attempt_count,
                                                                                               ntp.now(),
                                                                                               auditVerification.shard_id
                                                                                           ])
                                                                                           : updateTransactions[shardID].push([
                                                                                               auditVerification.verification_count,
                                                                                               auditVerification.attempt_count,
                                                                                               ntp.now(),
                                                                                               1,
                                                                                               auditVerification.transaction_id
                                                                                           ]);
                                                                                   newAuditPointTransactions[shardID].push([
                                                                                       auditPointID,
                                                                                       auditVerification.transaction_id,
                                                                                       auditVerification.shard_id
                                                                                   ]);
                                                                               }
                                                                               else {
                                                                                   newInfo ? newTransactions[shardID].push([
                                                                                               auditVerification.transaction_id,
                                                                                               auditVerification.verification_count,
                                                                                               auditVerification.attempt_count,
                                                                                               null,
                                                                                               auditVerification.shard_id
                                                                                           ])
                                                                                           : updateTransactions[shardID].push([
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
                                                                               newInfo ? newTransactions[shardID].push([
                                                                                           auditVerification.transaction_id,
                                                                                           auditVerification.verification_count,
                                                                                           auditVerification.attempt_count,
                                                                                           null,
                                                                                           auditVerification.shard_id
                                                                                       ])
                                                                                       : updateTransactions[shardID].push([
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

                                                      async.eachSeries(_.keys(newTransactions), (shardID, callback) => {
                                                          const auditVerification = database.getRepository('audit_verification', shardID);
                                                          const auditPoint        = database.getRepository('audit_point', shardID);
                                                          console.log('[audit point] audit round ', auditPointID, ' add ', newTransactions[shardID].length, ' audit verifications');
                                                          auditVerification.addAuditVerificationEntries(newTransactions[shardID])
                                                                           .then(() => {
                                                                               console.log('[audit point] audit round ', auditPointID, ' update ', updateTransactions[shardID].length, ' audit verifications');
                                                                               return auditVerification.updateAuditVerification(updateTransactions[shardID]);
                                                                           })
                                                                           .then(() => {
                                                                               console.log('[audit point] audit round ', auditPointID, '  add ', newAuditPointTransactions[shardID].length, ' transactions to audit point');
                                                                               return auditPoint.addTransactionToAuditPointEntries(newAuditPointTransactions[shardID]);
                                                                           })
                                                                           .then(() => {
                                                                               console.log('[audit point] audit round ', auditPointID, ' finished after receiving all replies');
                                                                               callback();
                                                                           })
                                                                           .catch((err) => {
                                                                               console.err('[audit point] Error on audit round ', auditPointID, '. [message]: ', err);
                                                                               callback();
                                                                           });
                                                      }, () => {
                                                          eventBus.removeAllListeners('audit_point_validation_response:' + auditPointID);
                                                          delete self._activeAuditPointUpdateRound[auditPointID];
                                                          resolve();
                                                      });
                                                  });

                                              });

                                              _.each(selectedNodeList, ws => {
                                                  console.log('[audit point] Ask ', ws.node, ' for audit point validation');
                                                  self._activeAuditPointUpdateRound[auditPointID].nodes[ws.node] = {replied: false};
                                                  peer.auditPointValidationRequest({
                                                      audit_point_id     : auditPointID,
                                                      transaction_id_list: _.map(pendingAuditPointTransactions, data => data.transaction.transaction_id)
                                                  }, ws);
                                              });
                                          });

            });
        });

    }

    _onTransactionValidationRequest(data, ws) {
        walletTransactionConsensus.validateTransactionInConsensusRound(data, ws);
    }

    _onTransactionValidationNodeAllocate(data, ws) {
        walletTransactionConsensus.allocateNodeToValidateTransaction(data, ws);
    }

    _onTransactionValidationNodeRelease(data, ws) {
        walletTransactionConsensus.releaseNodeToValidateTransaction(data, ws);
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
            database.applyShards((shardID) => {
                const auditPointRepository = database.getRepository('audit_point', shardID);
                return auditPointRepository.getValidAuditPoints(transactions);
            }).then(validAuditPoints => {
                validAuditPoints = Array.from(new Set(validAuditPoints));
                let ws           = network.getWebSocketByID(connectionID);
                if (ws) {
                    peer.auditPointValidationResponse(_.map(validAuditPoints, transactions => transactions.transaction_id), auditPointID, ws);
                }
                unlock();
            });
        }, undefined, Date.now() + config.AUDIT_POINT_VALIDATION_WAIT_TIME_MAX);
    }


    _onNewPeerConnection(ws) {
        if (this.initialized) {
            this.syncAddresses(ws).then(_ => _);
        }
        walletSync.doProgressiveSync(ws);
    }

    _onPeerConnectionClosed(ws) {
        walletSync.stopProgressiveSync(ws);
    }

    _doShardZeroPruning() {
        return new Promise(resolve => {
            mutex.lock(['shard-zero-pruning'], unlock => {

                return database.getRepository('keychain')
                               .getWalletKnownKeyIdentifier()
                               .then(knownKeyIdentifierSet => {
                                   return database.getRepository('transaction') // shard zero
                                                  .pruneShardZero(knownKeyIdentifierSet);
                               })
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

    _doTransactionSetForPruning() {
        return new Promise(resolve => {
            mutex.lock(['transaction-set-pruning'], unlock => {
                return database.getRepository('audit_point') // shard zero
                               .updateTransactionToPrune(this.defaultKeyIdentifier)
                               .then(() => {
                                   unlock();
                                   resolve();
                               });
            });
        });
    }

    _doTransactionPruning() {
        console.log('\n\n\nPRUNING\n\n\n');

        if (mutex.getKeyQueuedSize(['transaction-pruning']) > 0) { // a prune task is running.
            return Promise.resolve();
        }

        return new Promise(resolve => {
            mutex.lock(['transaction-pruning'], unlock => {
                this.lockProcessNewTransaction();
                database.getRepository('audit_point') // shard zero
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
                database.getRepository('audit_point') // shard zero
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
        console.log('[wallet] status (_transactionReceivedFromNetwork:', networkTransactions.length, ' | _transactionValidationRejected:', walletTransactionConsensus.getRejectedTransactionList().size, ' | _activeConsensusRound:', _.keys(this._activeConsensusRound).length + ')');

        if (!this._maxBacklogThresholdReached && mutex.getKeyQueuedSize(['transaction'], true) >= config.WALLET_TRANSACTION_QUEUE_SIZE_MAX) {
            this._maxBacklogThresholdReached = true;
            this.lockProcessNewTransaction();
        }
        else if (this._maxBacklogThresholdReached && mutex.getKeyQueuedSize(['transaction'], true) <= config.WALLET_TRANSACTION_QUEUE_SIZE_MAX) {
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

    _doTransactionOutputExpiration() {
        return new Promise(resolve => {
            console.log('[Wallet] Starting transaction output expiration');
            mutex.lock(['transaction-output-expiration'], unlock => {
                let time = ntp.now();
                time.setMinutes(time.getMinutes() - config.TRANSACTION_OUTPUT_EXPIRE_OLDER_THAN);

                return database.getRepository('transaction').expireTransactions(time)
                               .then(() => {
                                   unlock();
                                   resolve();
                               });
            });
        });
    }

    // A job that refreshes outputs that are near expiration
    _doTransactionOutputRefresh() {
        return new Promise(resolve => {
            mutex.lock(['transaction-output-refresh'], unlock => {
                console.log('[Wallet] Starting refreshing');
                let time = ntp.now();
                time.setMinutes(time.getMinutes() - config.TRANSACTION_OUTPUT_REFRESH_OLDER_THAN);

                const walletID = this.getDefaultActiveWallet();
                if (!walletID) {
                    resolve();
                    unlock();
                    return;
                }

                database.getRepository('keychain').getWalletDefaultKeyIdentifier(walletID)
                        .then((addressKeyIdentifier) => {
                            if (addressKeyIdentifier === null) {
                                throw new Error('No address key identifier');
                            }

                            return this.findAllExpiredOrNearExpiredOutputs(addressKeyIdentifier, time)
                                       .then(inputs => {
                                           if (inputs.length === 0) {
                                               throw new Error('no outputs that need to be refreshed');
                                           }

                                           console.log(`[wallet] Found ${inputs.length} outputs that need to be refreshed.`);
                                           return [
                                               inputs,
                                               addressKeyIdentifier
                                           ];
                                       });
                        })
                        .then(([inputs, addressKeyIdentifier]) => {
                            let neededAddresses = {};

                            for (let input of inputs) {
                                if (!(input.address in neededAddresses)) {
                                    neededAddresses[input.address] = true;
                                }
                            }

                            const extendedPrivateKey = this.getActiveWalletKey(walletID);

                            //TODO - query address by address
                            return this.getWalletAddresses()
                                       .then(addresses => {
                                           // Looking for the keys and address
                                           // bases that are needed to spend
                                           // these inputs
                                           let keyMap       = {};
                                           let addressBases = [];

                                           for (let address of addresses) {
                                               if (address.address in neededAddresses) {
                                                   const privateKey             = walletUtils.derivePrivateKey(extendedPrivateKey, 0, address.address_position);
                                                   keyMap[address.address_base] = privateKey;
                                                   addressBases.push(address.address_base);
                                               }
                                           }

                                           // Creating output - using the first
                                           // address in the list
                                           const addressBase    = addresses[0].address_base;
                                           const addressVersion = addresses[0].address_version;
                                           const amount         = _.sum(_.map(inputs, i => i.amount));

                                           const output = {
                                               address_base          : addressBase,
                                               address_version       : addressVersion,
                                               address_key_identifier: addressKeyIdentifier,
                                               amount
                                           };

                                           return [
                                               keyMap,
                                               addressBases,
                                               output
                                           ];
                                       })
                                       .then(([keyMap, addressBases, output]) => {
                                           let fieldMap = {
                                               'transaction_id'  : 'output_transaction_id',
                                               'transaction_date': 'output_transaction_date',
                                               'shard_id'        : 'output_shard_id'
                                           };

                                           const addressRepository = database.getRepository('address');

                                           for (let input of inputs) {
                                               const addressComponent   = addressRepository.getAddressComponent(input.address);
                                               input['address_base']    = addressComponent['address'];
                                               input['address_version'] = addressComponent['version'];
                                           }

                                           const srcInputs = _.map(inputs, o => _.mapKeys(_.pick(o, [
                                               'transaction_id',
                                               'output_position',
                                               'transaction_date',
                                               'shard_id',
                                               'address_base',
                                               'address_version',
                                               'address_key_identifier'
                                           ]), (v, k) => fieldMap[k] ? fieldMap[k] : k));

                                           return this.signAndStoreTransaction(srcInputs, [output], addressBases, keyMap, config.WALLET_TRANSACTION_REFRESH_VERSION)
                                                      .then((transaction) => {
                                                          return transaction;
                                                      });
                                       });
                        })
                        .then((transaction) => {
                            console.log(`[wallet] Successfully stored and propagated refresh transaction ${transaction.transaction_id}`);
                            resolve();
                            unlock();
                        })
                        .catch((e) => {
                            console.log(`[wallet] Failed to refresh outputs. Error: ${e}`);
                            resolve();
                            unlock();
                        });
            });
        });
    }

    findAllExpiredOrNearExpiredOutputs(addressKeyIdentifier, time) {
        return new Promise((resolve) => {
            return database.applyShards((shardID) => {
                return new Promise((resolve) => {
                    database.getRepository('transaction', shardID)
                            .getUnspentTransactionOutputsOlderThanOrExpired(addressKeyIdentifier, time)
                            .then(result => resolve(result))
                            .catch(err => {
                                console.log(`[wallet] Failed to get expired or near expired outputs for shard ${shardID}. Error: ${err}`);
                                resolve([]);
                            });
                });
            }).then(allOutputs => resolve(allOutputs));
        });
    }

    signAndStoreTransaction(srcInputs, dstOutputs, addressBases, privateKeyMap, transactionVersion) {
        return ntp.getTime()
                  .then(time => {
                      const transactionDate = new Date(Math.floor(time.now.getTime() / 1000) * 1000);

                      return walletUtils.signTransaction(srcInputs, dstOutputs, privateKeyMap, transactionDate, transactionVersion)
                                        .then(transaction =>
                                            walletUtils.verifyTransaction(transaction)
                                                       .then(isValid => {
                                                           if (!isValid) {
                                                               return Promise.reject('tried to sign and store and invalid transaction');
                                                           }
                                                           else {
                                                               return database.getRepository('transaction')
                                                                              .addTransactionFromObject(transaction);
                                                           }
                                                       }))
                                        .then(transaction => transaction);
                  });
    }

    _initializeEvents() {
        walletSync.initialize()
                  .then(() => walletTransactionConsensus.initialize())
                  .then(() => {
                      eventBus.on('peer_connection_new', this._onNewPeerConnection.bind(this));
                      eventBus.on('peer_connection_closed', this._onPeerConnectionClosed.bind(this));
                      eventBus.on('transaction_new', this._onNewTransaction.bind(this));
                      eventBus.on('transaction_sync', this._onSyncTransaction.bind(this));
                      eventBus.on('transaction_sync_by_date', this._onSyncTransactionByDate.bind(this));
                      eventBus.on('transaction_sync_response', this._onTransactionSyncResponse.bind(this));
                      eventBus.on('transaction_sync_by_date_response', this._onTransactionSyncByDateResponse.bind(this));
                      eventBus.on('shard_sync_request', this._onSyncShard.bind(this));
                      eventBus.on('address_transaction_sync', this._onSyncAddressBalance.bind(this));
                      eventBus.on('transaction_validation_request', this._onTransactionValidationRequest.bind(this));
                      eventBus.on('transaction_validation_node_allocate', this._onTransactionValidationNodeAllocate.bind(this));
                      eventBus.on('transaction_validation_node_release', this._onTransactionValidationNodeRelease.bind(this));
                      eventBus.on('transaction_include_path_request', this._onTransactionIncludePathRequest.bind(this));
                      eventBus.on('transaction_spend_request', this._onSyncTransactionSpendTransaction.bind(this));
                      eventBus.on('transaction_output_spend_request', this._onSyncOutputSpendTransaction.bind(this));
                      eventBus.on('transaction_output_spend_response', this._onSyncOutputSpendTransactionResponse.bind(this));
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
                                              this.initialized          = true;
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
            this.initialized = true;
            return Promise.resolve(this.getDefaultActiveWallet());
        }
    }

    stop() {
        this.initialized = false;
        walletSync.close().then(_ => _).catch(_ => _);
        eventBus.removeAllListeners('peer_connection_new');
        eventBus.removeAllListeners('peer_connection_closed');
        eventBus.removeAllListeners('transaction_new');
        eventBus.removeAllListeners('transaction_sync');
        eventBus.removeAllListeners('transaction_sync_by_date');
        eventBus.removeAllListeners('transaction_sync_response');
        eventBus.removeAllListeners('transaction_sync_by_date_response');
        eventBus.removeAllListeners('shard_sync_request');
        eventBus.removeAllListeners('address_transaction_sync');
        eventBus.removeAllListeners('transaction_validation_request');
        eventBus.removeAllListeners('transaction_include_path_request');
        eventBus.removeAllListeners('transaction_spend_request');
        eventBus.removeAllListeners('transaction_output_spend_request');
        eventBus.removeAllListeners('transaction_output_spend_response');
        eventBus.removeAllListeners('audit_point_validation_request');
    }
}


export default new Wallet();
