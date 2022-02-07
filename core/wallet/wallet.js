import walletUtils from './wallet-utils';
import walletSync from './wallet-sync';
import walletTransactionConsensus from './wallet-transaction-consensus';
import database from '../../database/database';
import eventBus from '../event-bus';
import signature from '../crypto/signature';
import objectHash from '../crypto/object-hash';
import readline from 'readline';
import Mnemonic from 'bitcore-mnemonic';
import peer from '../../net/peer';
import async from 'async';
import _ from 'lodash';
import genesisConfig from '../genesis/genesis-config';
import config, {NODE_MILLIX_BUILD_DATE, NODE_MILLIX_VERSION} from '../config/config';
import network from '../../net/network';
import mutex from '../mutex';
import ntp from '../ntp';
import path from 'path';
import console from '../console';
import base58 from 'bs58';
import task from '../task';
import cache from '../cache';

export const WALLET_MODE = {
    CONSOLE: 'CONSOLE',
    APP    : 'APP'
};


class Wallet {

    constructor() {
        this.mode                            = WALLET_MODE.CONSOLE;
        this.INACTIVE_SHARD_ID               = 'AyAC3kjLtjM4vktAJ5Xq6mbXKjzEqXoSsmGhhgjnkXUvjtF2M';
        this._activeWallets                  = {};
        this._activeConsensusRound           = {};
        this._transactionReceivedFromNetwork = {};
        this._transactionOnRoute             = {};
        this._transactionRequested           = {};
        this._transactionFundingActiveWallet = {};
        this.defaultKeyIdentifier            = undefined;
        this._lockProcessNewTransaction      = 0;
        this._maxBacklogThresholdReached     = false;
        this.initialized                     = false;
        this._transactionSendInterrupt       = false;
        this._activeShards                   = new Set();

        this._activeShards.add(genesisConfig.genesis_shard_id);
        if (!config.MODE_TEST_NETWORK) {
            this._activeShards.add(this.INACTIVE_SHARD_ID);
        }
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
                        console.log('[wallet] activating wallet');
                        resolve(passphrase);
                    }
                );
            }
            eventBus.removeAllListeners('wallet_key');
            eventBus.once('wallet_key', passphrase => {
                console.enable();
                console.log('[wallet] activating wallet');
                resolve(passphrase);
            });
            eventBus.emit('wallet_ready', {create: isNewMnemonic});
        });
    }

    createMnemonic() {
        const mnemonic = walletUtils.newMnemonic();
        return mnemonic.phrase;
    }

    getMnemonic(createIfNotExits) {
        return new Promise((resolve) => {
            walletUtils.loadMnemonic()
                       .then(([passphrase, isNewMnemonic]) => resolve([
                           passphrase,
                           isNewMnemonic
                       ]))
                       .catch(() => {
                           console.log('[wallet] ' + (createIfNotExits ? 'Creating new mnemonic' : 'No wallet found in the system'));
                           let passphrase = undefined;
                           if (createIfNotExits) {
                               passphrase = this.createMnemonic();
                               console.log('[wallet] creating a new mnemonic. please backup these 24 words to be able to recover you wallet.');
                               console.log('[wallet] mnemonic phrase => ', passphrase);
                           }
                           resolve(createIfNotExits ? [
                               passphrase,
                               true
                           ] : [
                               undefined,
                               false
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

    getKeyIdentifier() {
        return this.defaultKeyIdentifier;
    }

    deriveAndSaveAddress(walletID, isChange, addressPosition) {
        const keychain = database.getRepository('keychain');
        let {
                address          : addressBase,
                address_attribute: addressAttribute
            }          = this.deriveAddress(walletID, isChange, addressPosition);
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

    addTransaction(dstOutputs, outputFee, srcOutputs, transactionVersion) {
        const addressRepository = database.getRepository('address');
        return new Promise((resolve, reject) => {
            mutex.lock(['write'], (unlock) => {
                this._transactionSendInterrupt = false;
                let transactionOutputIDSpent   = new Set();
                return new Promise(resolve => {
                    if (!srcOutputs) {
                        return database.applyShards((shardID) => {
                            const transactionRepository = database.getRepository('transaction', shardID);
                            return new Promise((resolve, reject) => transactionRepository.getFreeOutput(this.defaultKeyIdentifier)
                                                                                         .then(outputs => outputs.length ? resolve(outputs) : reject()));
                        }).then(resolve);
                    }
                    else {
                        resolve(srcOutputs);
                    }
                })
                    .then((outputs) => {
                        const availableOutputs = [];
                        const keychainRepository = database.getRepository('keychain');
                        return keychainRepository.getAddresses(_.uniq(_.map(outputs, output => output.address))).then(addresses => {
                            const mapAddresses = {};
                            addresses.forEach(address => mapAddresses[address.address] = address);

                            for (let i = 0; i < outputs.length; i++) {
                                const output        = outputs[i];

                                if (cache.getCacheItem('wallet', `is_spend_${output.transaction_id}_${output.output_position}`)) {
                                    continue;
                                }

                                const outputAddress = mapAddresses[output.address];
                                if (!outputAddress) {
                                    console.log('[wallet][warn] output address not found', output);
                                    const {address: missingAddress} = addressRepository.getAddressComponent(output.address);
                                    //TODO: find a better way to get the address
                                    for (let addressPosition = 0; addressPosition < 2 ** 32; addressPosition++) {
                                        let {
                                                address          : addressBase,
                                                address_attribute: addressAttribute
                                            } = this.deriveAddress(this.getDefaultActiveWallet(), 0, addressPosition);
                                        if (addressBase === missingAddress) {
                                            output['address_version']        = addressRepository.getDefaultAddressVersion().version;
                                            output['address_key_identifier'] = this.defaultKeyIdentifier;
                                            output['address_base']           = addressBase;
                                            output['address_position']       = addressPosition;
                                            output['address_attribute']      = addressAttribute;
                                            break;
                                        }
                                    }
                                }
                                else {
                                    output['address_version']        = outputAddress.address_version;
                                    output['address_key_identifier'] = outputAddress.address_key_identifier;
                                    output['address_base']           = outputAddress.address_base;
                                    output['address_position']       = outputAddress.address_position;
                                    output['address_attribute']      = outputAddress.address_attribute;
                                }
                                availableOutputs.push(output);
                            }
                            return availableOutputs;
                        });
                    })
                    .then((outputs) => {
                        if (!outputs || outputs.length === 0) {
                            return Promise.reject({
                                error: 'insufficient_balance',
                                data : {balance_stable: 0}
                            });
                        }
                        outputs = _.orderBy(outputs, ['amount'], ['asc']);

                        const transactionAmount   = _.sum(_.map(dstOutputs, o => o.amount)) + outputFee.amount;
                        let remainingAmount       = transactionAmount;
                        const outputsToUse        = [];
                        const privateKeyMap       = {};
                        const addressAttributeMap = {};

                        for (let i = 0; i < outputs.length && remainingAmount > 0; i++) {

                            if (i === config.TRANSACTION_INPUT_MAX - 1) { /* we cannot add more inputs and still we did not aggregate the required amount for the transaction */
                                return Promise.reject({
                                    error: 'transaction_input_max_error',
                                    data : {amount_max: transactionAmount - remainingAmount}
                                });
                            }

                            let output                               = outputs[i];
                            remainingAmount -= output.amount;
                            const extendedPrivateKey                 = this.getActiveWalletKey(this.getDefaultActiveWallet());
                            const privateKeyBuf                      = walletUtils.derivePrivateKey(extendedPrivateKey, 0, output.address_position);
                            privateKeyMap[output.address_base]       = privateKeyBuf.toString('hex');
                            addressAttributeMap[output.address_base] = output.address_attribute;
                            outputsToUse.push(output);
                        }

                        if (remainingAmount > 0) {
                            return Promise.reject({
                                error: 'insufficient_balance',
                                data : {balance_stable: transactionAmount - remainingAmount}
                            });
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

                        srcInputs.forEach(input => transactionOutputIDSpent.add(input.transaction_id));

                        let amountSent     = _.sum(_.map(dstOutputs, o => o.amount)) + outputFee.amount;
                        let totalUsedCoins = _.sum(_.map(outputsToUse, o => o.amount));
                        let change         = totalUsedCoins - amountSent;
                        if (change > 0) {
                            let addressChange = outputs[outputs.length - 1];
                            dstOutputs.push({
                                address_base          : addressChange.address_base,
                                address_version       : addressChange.address_version,
                                address_key_identifier: addressChange.address_key_identifier,
                                amount                : change
                            });
                        }
                        return this.signAndStoreTransaction(srcInputs, dstOutputs, outputFee, addressAttributeMap, privateKeyMap, transactionVersion || config.WALLET_TRANSACTION_DEFAULT_VERSION);
                    })
                    .then(transactionList => {
                        transactionList.forEach(transaction => peer.transactionSend(transaction));
                        return transactionList;
                    })
                    .then((transactionList) => {
                        this._transactionSendInterrupt = false;
                        resolve(transactionList);
                        //wait 1 second then start the validation process
                        setTimeout(() => walletTransactionConsensus.doValidateTransaction(), 1000);
                        unlock();
                    })
                    .catch((e) => {
                        this._transactionSendInterrupt = false;

                        if (e === 'transaction_proxy_rejected') {
                            this.resetTransactionValidationRejected();
                        }

                        reject({error: e});
                        unlock();
                    });
            });
        });
    }

    interruptTransactionSendInProgress() {
        this._transactionSendInterrupt = true;
    }

    sign(address, message) {
        const extendedPrivateKey = this.getActiveWalletKey(address.wallet_id);
        const privateKeyBuf      = walletUtils.derivePrivateKey(extendedPrivateKey, 0, address.address_position);
        return signature.sign(objectHash.getHashBuffer(message), privateKeyBuf);
    }

    syncWalletTransactions(ws) {
        if (!this.defaultKeyIdentifier || !!cache.getCacheItem('wallet', 'is_wallet_transaction_synced')) {
            return Promise.resolve();
        }

        cache.setCacheItem('wallet', 'is_wallet_transaction_synced', true, 300000); /* do sync again on a new connection after 5min */

        return new Promise(resolve => {
            mutex.lock(['sync-wallet-balance-request'], unlock => {
                async.eachSeries([
                    this.defaultKeyIdentifier,
                    ...config.EXTERNAL_WALLET_KEY_IDENTIFIER
                ], (addressKeyIdentifier, callback) => {
                    peer.walletTransactionSync(addressKeyIdentifier, ws);
                    setTimeout(() => callback(), 1000);
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

    _checkIfWalletUpdate(addressesKeyIdentifierSet) {
        if (addressesKeyIdentifierSet.has(this.defaultKeyIdentifier)) {
            eventBus.emit('wallet_update');
            // start consensus in 1s
            setTimeout(() => walletTransactionConsensus.doValidateTransaction(), 1000);
        }
    }

    getAllTransactions() {
        return database.applyShards((shardID) => {
            return database.getRepository('transaction', shardID)
                           .getTransactionsByAddressKeyIdentifier(this.defaultKeyIdentifier);
        }, 'transaction_date desc');
    }

    getTransactionCount() {
        return database.applyShards((shardID) => {
            return database.getRepository('transaction', shardID)
                           .getTransactionCountByAddressKeyIdentifier(this.defaultKeyIdentifier);
        }).then(transactionCountList => {
            return _.sum(transactionCountList);
        });
    }

    isProcessingTransaction(transactionID) {
        return this._transactionReceivedFromNetwork[transactionID] === true;
    }

    isRequestedTransaction(transactionID) {
        return !!this._transactionRequested[transactionID];
    }

    requestTransactionFromNetwork(transactionID, options = {}, isTransactionFundingWallet = false) {
        if (isTransactionFundingWallet) {
            this._transactionFundingActiveWallet[transactionID] = Date.now();
        }
        peer.transactionSyncRequest(transactionID, options)
            .then(() => this._transactionRequested[transactionID] = Date.now())
            .catch(_ => _);
    }

    transactionHasKeyIdentifier(transaction, keyIdentifierSet = new Set()) {

        if (keyIdentifierSet.size === 0) {
            keyIdentifierSet.add(this.defaultKeyIdentifier);
            config.EXTERNAL_WALLET_KEY_IDENTIFIER.forEach(externalKeyIdentifier => keyIdentifierSet.add(externalKeyIdentifier));
        }

        for (let input of transaction.transaction_input_list) {
            if (keyIdentifierSet.has(input.address_key_identifier)) {
                return true;
            }
        }
        for (let output of transaction.transaction_output_list) {
            if (keyIdentifierSet.has(output.address_key_identifier)) {
                return true;
            }
        }
        return false;
    }

    transactionSpendRequest(transactionID, priority) {
        return new Promise((resolve, reject) => {
            peer.transactionSpendRequest(transactionID)
                .then(response => {
                    async.eachSeries(response.transaction_id_list, (spendTransactionID, callback) => {
                        if (!this._transactionReceivedFromNetwork[spendTransactionID]) {
                            database.firstShards((shardID) => {
                                const transactionRepository = database.getRepository('transaction', shardID);
                                return new Promise((resolve, reject) => transactionRepository.hasTransaction(spendTransactionID)
                                                                                             .then(hasTransaction => hasTransaction ? resolve(hasTransaction) : reject()));
                            }).then(hasTransaction => {
                                if (!hasTransaction) {
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

    resetTransactionValidationByTransactionId(transactionID) {
        return database.applyShards(shardID => {
            const transactionRepository = database.getRepository('transaction', shardID);
            return transactionRepository.getTransactionObject(transactionID)
                                        .then((transaction) => {
                                            if (transaction) { // transaction data not found
                                                return transactionRepository.resetTransaction(transactionID)
                                                                            .then(() => {
                                                                                return this.resetValidation(new Set([transaction.transaction_id]), shardID);
                                                                            });
                                            }
                                        });
        });
    }

    resetTransactionValidationRejected() {
        walletTransactionConsensus.resetTransactionValidationRejected();
        database.applyShards(shardID => {
            const transactionRepository = database.getRepository('transaction', shardID);
            return transactionRepository.listTransactionWithFreeOutput(this.defaultKeyIdentifier, true)
                                        .then(transactions => new Promise(resolve => {
                                            async.eachSeries(transactions, (transaction, callback) => {
                                                transactionRepository.resetTransaction(transaction.transaction_id)
                                                                     .then(() => callback())
                                                                     .catch(() => callback());
                                            }, () => resolve(new Set(_.map(transactions, t => t.transaction_id))));
                                        }))
                                        .then(rootTransactions => this.resetValidation(rootTransactions, shardID))
                                        .then(result => result ? resolve(result) : reject());
        }).then(_ => _);
    }

    resetValidation(rootTransactions, shardID) {
        const transactionRepository = database.getRepository('transaction', shardID);
        return new Promise((resolve) => {
            const dfs = (transactions, visited = new Set()) => {
                const listInputTransactionIdSpendingTransaction = new Set();
                async.eachSeries(transactions, (transactionID, callback) => {
                    transactionRepository.listTransactionInput({'output_transaction_id': transactionID})
                                         .then(inputs => {
                                             inputs.forEach(input => {
                                                 if (!visited.has(input.transaction_id)) {
                                                     listInputTransactionIdSpendingTransaction.add(input.transaction_id);
                                                     visited.add(input.transaction_id);
                                                 }
                                             });
                                             callback();
                                         }).catch(() => callback());
                }, () => {
                    async.eachSeries(listInputTransactionIdSpendingTransaction, (transactionID, callback) => {
                        transactionRepository.resetTransaction(transactionID)
                                             .then(() => callback())
                                             .catch(() => callback());
                    }, () => {
                        if (listInputTransactionIdSpendingTransaction.size > 0) {
                            dfs(listInputTransactionIdSpendingTransaction, visited);
                        }
                        else {
                            resolve();
                        }
                    });
                });
            };
            dfs(rootTransactions);
        });

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

    enableTransactionSync(transactionID) {
        this._transactionFundingActiveWallet[transactionID] = new Date();
    }

    flagTransactionAsRequested(transactionID) {
        this._transactionRequested[transactionID] = Date.now();
    }

    _shouldProcessTransaction(transaction) {
        let transactionDate;
        if ([
            '0a0',
            '0b0',
            'la0l',
            'lb0l'
        ].includes(transaction.version)) {
            transactionDate = new Date(transaction.transaction_date).getTime() / 1000;
        }
        else {
            transactionDate = transaction.transaction_date;
        }

        if (transaction.shard_id !== genesisConfig.genesis_shard_id && transactionDate > 1643234996 || !this._activeShards.has(transaction.shard_id) && transactionDate <= 1643234996) { /* do not accept transactions to other shards after this timestamp*/
            return false;
        }

        if (!!this._transactionFundingActiveWallet[transaction.transaction_id] || this.transactionHasKeyIdentifier(transaction)) {
            return true;
        }

        const isExpired = database.getRepository('transaction').isExpired(transactionDate);
        if (isExpired && !database.getShard(transaction.shard_id)) { // not a supported shard
            return false;
        }
        else {
            return true;
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

        const hasKeyIdentifier = this.transactionHasKeyIdentifier(transaction);

        if (!hasKeyIdentifier && !this.isProcessingNewTransactionFromNetwork && !this.isRequestedTransaction(transaction.transaction_id)) {
            walletSync.clearTransactionSync(transaction.transaction_id);
            walletSync.add(transaction.transaction_id, {
                delay   : 5000,
                priority: this.getTransactionSyncPriority(transaction)
            });
            return;
        }

        // check if we should accept this transaction
        if (!this._shouldProcessTransaction(transaction)) {
            return walletSync.removeTransactionSync(transaction.transaction_id);
        }

        this._transactionReceivedFromNetwork[transaction.transaction_id] = true;
        return this.syncShardIfNotExists(transaction, ws)
                   .then(() => {
                       // check if the transaction is in the shard zero
                       const shardZeroTransactionRepository = database.getRepository('transaction'); // shard zero
                       return shardZeroTransactionRepository.hasTransaction(transaction.transaction_id)
                                                            .then(hasTransaction => {
                                                                const transactionRepository = database.getRepository('transaction', transaction.shard_id);
                                                                if (!hasTransaction && transactionRepository) { // if not in the shard zero, check if it's in it's default shard
                                                                    return transactionRepository.hasTransaction(transaction.transaction_id);
                                                                }
                                                                else {
                                                                    return hasTransaction;
                                                                }
                                                            })
                                                            .then(hasTransaction => {

                                                                if (hasTransaction) {
                                                                    delete this._transactionReceivedFromNetwork[transaction.transaction_id];
                                                                    delete this._transactionRequested[transaction.transaction_id];
                                                                    delete this._transactionFundingActiveWallet[transaction.transaction_id];
                                                                    return eventBus.emit('transaction_new:' + transaction.transaction_id, transaction);
                                                                }

                                                                return walletUtils.verifyTransaction(transaction)
                                                                                  .then(validTransaction => {

                                                                                      if (!validTransaction) {
                                                                                          console.log('Invalid transaction received from network. Set all children as invalid');

                                                                                          database.applyShards((shardID) => {
                                                                                              return database.getRepository('transaction', shardID)
                                                                                                             .invalidateTransaction(transaction.transaction_id);
                                                                                          }).then(_ => _).catch(err => console.log(`Failed to find and set spenders as invalid. Error: ${err}`));

                                                                                          eventBus.emit('badTransaction:' + transaction.transaction_id);
                                                                                          delete this._transactionReceivedFromNetwork[transaction.transaction_id];
                                                                                          delete this._transactionRequested[transaction.transaction_id];
                                                                                          delete this._transactionFundingActiveWallet[transaction.transaction_id];
                                                                                          walletSync.removeTransactionSync(transaction.transaction_id);
                                                                                          // return false;
                                                                                      }

                                                                                      const isFundingWallet = !!this._transactionFundingActiveWallet[transaction.transaction_id];
                                                                                      const syncPriority    = isFundingWallet ? 1 : this.getTransactionSyncPriority(transaction);
                                                                                      delete this._transactionFundingActiveWallet[transaction.transaction_id];

                                                                                      if (syncPriority === 1) {
                                                                                          console.log(`[wallet] wallet-key-identifier >> transaction found ${transaction.transaction_id}`);
                                                                                      }

                                                                                      let transactionRepository = shardZeroTransactionRepository;

                                                                                      if (![
                                                                                          '0a0',
                                                                                          '0b0',
                                                                                          'la0l',
                                                                                          'lb0l'
                                                                                      ].includes(transaction.version)) {
                                                                                          transaction.transaction_date = new Date(transaction.transaction_date * 1000).toISOString();
                                                                                      }

                                                                                      if (new Date(transaction.transaction_date).getTime() <= (Date.now() - config.TRANSACTION_PRUNE_AGE_MIN * 60000)) {
                                                                                          let shardTransactionRepository = database.getRepository('transaction', transaction.shard_id);
                                                                                          if (shardTransactionRepository || hasKeyIdentifier || transaction.shard_id === this.INACTIVE_SHARD_ID) {
                                                                                              transactionRepository = shardTransactionRepository || transactionRepository;
                                                                                          }
                                                                                          else {
                                                                                              delete this._transactionReceivedFromNetwork[transaction.transaction_id];
                                                                                              delete this._transactionRequested[transaction.transaction_id];
                                                                                              return Promise.resolve();
                                                                                          }
                                                                                      }

                                                                                      console.log('New Transaction from network ', transaction.transaction_id);
                                                                                      transaction.transaction_input_list.forEach(input => cache.setCacheItem('wallet', `is_spend_${input.output_transaction_id}_${input.output_position}`, true, 300000));
                                                                                      return transactionRepository.addTransactionFromObject(transaction, hasKeyIdentifier)
                                                                                                                  .then(() => {
                                                                                                                      console.log('[Wallet] Removing ', transaction.transaction_id, ' from network transaction cache');
                                                                                                                      eventBus.emit('transaction_new:' + transaction.transaction_id, transaction);
                                                                                                                      this._checkIfWalletUpdate(new Set(_.map(transaction.transaction_output_list, o => o.address_key_identifier)));

                                                                                                                      eventBus.emit('wallet_event_log', {
                                                                                                                          type   : 'transaction_new',
                                                                                                                          content: data,
                                                                                                                          from   : node
                                                                                                                      });

                                                                                                                      walletSync.clearTransactionSync(transaction.transaction_id);

                                                                                                                      this.transactionSpendRequest(transaction.transaction_id, syncPriority).then(_ => _).catch(_ => _);

                                                                                                                      walletSync.syncTransactionSpendingOutputs(transaction);

                                                                                                                      if (transaction.transaction_id !== genesisConfig.genesis_transaction) {
                                                                                                                          _.each(transaction.transaction_input_list, inputTransaction => {
                                                                                                                              if (!this._transactionReceivedFromNetwork[inputTransaction.output_transaction_id]) {
                                                                                                                                  database.firstShards((shardID) => {
                                                                                                                                      const transactionRepository = database.getRepository('transaction', shardID);
                                                                                                                                      return new Promise((resolve, reject) => transactionRepository.hasTransaction(inputTransaction.output_transaction_id)
                                                                                                                                                                                                   .then(hasTransaction => hasTransaction ? resolve(hasTransaction) : reject()));
                                                                                                                                  }).then(hasTransaction => {
                                                                                                                                      if (!hasTransaction) {
                                                                                                                                          console.log('[Wallet] request sync input transaction ', inputTransaction.output_transaction_id);
                                                                                                                                          let options = {};
                                                                                                                                          // only flag transactions that don't have the key identifier and are from a wallet funding lineage, or transactions that are not from a funding lineage and have the key identifier
                                                                                                                                          if (isFundingWallet || hasKeyIdentifier) {
                                                                                                                                              this._transactionFundingActiveWallet[inputTransaction.output_transaction_id] = Date.now();

                                                                                                                                              options = {
                                                                                                                                                  dispatch_request  : true,
                                                                                                                                                  force_request_sync: true
                                                                                                                                              };
                                                                                                                                          }
                                                                                                                                          this._transactionRequested[inputTransaction.output_transaction_id] = Date.now();
                                                                                                                                          peer.transactionSyncRequest(inputTransaction.output_transaction_id, {priority: syncPriority, ...options})
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
                                                                                                                                                                                                   .then(hasTransaction => hasTransaction ? resolve(hasTransaction) : reject()));
                                                                                                                                  }).then(hasTransaction => {
                                                                                                                                      if (!hasTransaction) {
                                                                                                                                          console.log('[Wallet] request sync parent transaction ', parentTransactionID);
                                                                                                                                          this._transactionRequested[parentTransactionID] = Date.now();
                                                                                                                                          peer.transactionSyncRequest(parentTransactionID, {priority: syncPriority})
                                                                                                                                              .catch(_ => _);
                                                                                                                                      }
                                                                                                                                  });
                                                                                                                              }
                                                                                                                          });
                                                                                                                      }
                                                                                                                      if (!isRequestedBySync || hasKeyIdentifier) {
                                                                                                                          let ws = network.getWebSocketByID(connectionID);
                                                                                                                          peer.transactionSend(data.transaction, ws);
                                                                                                                      }

                                                                                                                      if (hasTransaction) {
                                                                                                                          setTimeout(() => walletTransactionConsensus.doValidateTransaction(), 0);
                                                                                                                      }

                                                                                                                      delete this._transactionReceivedFromNetwork[transaction.transaction_id];
                                                                                                                      delete this._transactionRequested[transaction.transaction_id];
                                                                                                                      const cachedValidation = cache.getCacheItem('validation', transaction.transaction_id);
                                                                                                                      if (cachedValidation && cachedValidation.cause === 'transaction_not_found') {
                                                                                                                          cache.removeCacheItem('validation', transaction.transaction_id);
                                                                                                                      }
                                                                                                                  });
                                                                                  });

                                                            });
                   })
                   .catch((err) => {
                       console.log('[wallet] cleanup dangling transaction ', transaction.transaction_id, '. [message]: ', err, 'from node', ws.node);
                       delete this._transactionReceivedFromNetwork[transaction.transaction_id];
                       delete this._transactionRequested[transaction.transaction_id];
                       walletSync.clearTransactionSync(transaction.transaction_id);
                       walletSync.add(transaction.transaction_id, {
                           delay   : 5000,
                           priority: this.getTransactionSyncPriority(transaction)
                       });
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

        if (mutex.getKeyQueuedSize(['transaction-sync-request']) > 10) {
            return;
        }

        mutex.lock(['transaction-sync-request'], (unlockTransactionSync) => {
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
                                         ]) : reject());
                });
            }).then(firstShardData => {
                const [transaction, transactionRepository] = firstShardData || [];
                unlockTransactionSync();
                if (transaction) {
                    let ws = network.getWebSocketByID(connectionID);
                    if (ws) {
                        try {
                            const normalizedTransaction = transactionRepository.normalizeTransactionObject(transaction);
                            if (normalizedTransaction) {
                                peer.transactionSyncResponse({
                                    transaction            : normalizedTransaction,
                                    depth                  : data.depth,
                                    routing                : data.routing,
                                    routing_request_node_id: data.routing_request_node_id
                                }, ws);
                                console.log(`[wallet] sending transaction ${data.transaction_id} to node ${ws.nodeID} (response time: ${Date.now() - startTimestamp}ms)`);
                                return;
                            }
                            else {
                                console.log('[wallet] it is not possible to normalize the transaction', data.transaction_id);
                            }
                        }
                        catch (e) {
                            console.log('[wallet] error sending transaction sync response. transaction normalization issue. ' + e.message);
                        }
                        peer.transactionSyncResponse({
                            transaction            : {transaction_id: data.transaction_id},
                            transaction_not_found  : true,
                            depth                  : data.depth,
                            routing                : data.routing,
                            routing_request_node_id: data.routing_request_node_id
                        }, ws);
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

                    walletSync.getTransactionSyncData(data.transaction_id)
                              .then(transactionSyncData => {
                                  if (transactionSyncData && transactionSyncData.attempt >= 2 * config.TRANSACTION_RETRY_SYNC_MAX) {
                                      return;
                                  }

                                  mutex.lock(['routing-transaction'], unlock => {

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
                                          depth          : data.depth,
                                          routing        : true,
                                          request_node_id: requestNodeID
                                      })
                                          .then(_ => _)
                                          .catch(_ => _);
                                      this._transactionRequested[transactionID] = Date.now();
                                  }, undefined, Date.now() + config.NETWORK_LONG_TIME_WAIT_MAX);
                              });
                }
            });
        });
    }

    _onSyncWalletBalanceResponse(data, ws) {
        mutex.lock(['sync-wallet-balance-response'], unlock => {
            const transactions = data.transaction_id_list || [];
            async.eachSeries(transactions, (transactionID, callback) => {
                if (!!cache.getCacheItem('sync', transactionID)) {
                    return callback();
                }
                database.firstShards((shardID) => {
                    const transactionRepository = database.getRepository('transaction', shardID);
                    return new Promise((resolve, reject) => transactionRepository.hasTransaction(transactionID)
                                                                                 .then(hasTransaction => hasTransaction ? resolve(hasTransaction) : reject()));
                }).then(hasTransaction => {
                    if (!hasTransaction) {
                        peer.transactionSyncRequest(transactionID, {priority: 1})
                            .then(_ => _)
                            .catch(_ => _);
                    }
                    else {
                        cache.setCacheItem('sync', transactionID, true, Number.MAX_SAFE_INTEGER);
                    }
                    callback();
                });
            }, () => unlock());
        });
    }

    _onSyncWalletBalance(data, ws) {

        const addressKeyIdentifier = data.address_key_identifier;
        const cachedTransactions   = cache.getCacheItem('wallet', 'wallet_transaction_sync_' + addressKeyIdentifier);
        if (cachedTransactions) {
            if (cachedTransactions.length > 0) {
                peer.walletTransactionSyncResponse(cachedTransactions, ws);
            }
            return;
        }
        else if (mutex.getKeyQueuedSize(['transaction']) >= (config.NODE_CONNECTION_OUTBOUND_MAX + config.NODE_CONNECTION_INBOUND_MAX)) {
            return;
        }

        let node         = ws.node;
        let connectionID = ws.connectionID;
        mutex.lock(['sync-wallet-balance'], unlock => {
            console.log('[wallet] transaction sync for wallet key identifier ', addressKeyIdentifier);
            eventBus.emit('wallet_event_log', {
                type   : 'wallet_transaction_sync',
                content: data,
                from   : node
            });

            const transactionRepository = database.getRepository('transaction', genesisConfig.genesis_shard_id);
            return transactionRepository.getTransactionToSyncWallet(addressKeyIdentifier).then(transactions => {
                console.log('[wallet] >>', transactions.length, ' transaction can be synced to wallet ', addressKeyIdentifier);
                let ws = network.getWebSocketByID(connectionID);
                if (transactions && transactions.length > 0 && ws) {
                    transactions = _.map(transactions, t => t.transaction_id);
                    peer.walletTransactionSyncResponse(transactions, ws);
                }
                cache.setCacheItem('wallet', 'wallet_transaction_sync_' + addressKeyIdentifier, transactions, 120000);
                unlock();
            }).catch(() => unlock());
        }, undefined, Date.now() + config.NETWORK_LONG_TIME_WAIT_MAX * 20);
    }


    _onSyncTransactionSpendTransaction(data, ws) {

        if (mutex.getKeyQueuedSize(['sync-transaction-spend']) > config.NODE_CONNECTION_INBOUND_MAX) {
            return peer.transactionSpendResponse(data.transaction_id, [], ws);
        }

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

    _onSyncOutputSpendTransaction(data, ws) { //TODO: check this

        if (mutex.getKeyQueuedSize(['sync-transaction-spend']) > config.NODE_CONNECTION_INBOUND_MAX) {
            return peer.transactionOutputSpendResponse(data.transaction_id, data.output_position, [], ws);
        }

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
                    if (ws) {
                        peer.transactionOutputSpendResponse(transactionID, transactionOutputPosition, transactions, ws);
                        console.log(`[wallet] sending transactions spending from output tx: ${data.transaction_id}:${data.output_position} to node ${ws.nodeID} (response time: ${Date.now() - startTimestamp}ms)`);
                    }
                    unlock();
                });
            }).catch(() => unlock());
        });
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
                                       const transactionRepository = database.getRepository('transaction', shard.shard_id);
                                       if (!transactionRepository) {
                                           return callback();
                                       }
                                       transactionRepository.getTransactionCount()
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
        }).then(() => jobRepository.getJobs() // update job attribute
                                   .then(jobs => {
                                       return nodeRepository.addNodeAttribute(network.nodeID, 'job_list', JSON.stringify(_.map(jobs, job => ({
                                           job_name: job.job_name,
                                           status  : job.status
                                       }))));
                                   }))
          .then(() => { // update node_about
              return database.getRepository('schema')
                             .get({key: 'version'})
                             .then(versionInfo => {
                                 if (!versionInfo) {
                                     return Promise.reject('[wallet] cannot create node about attribute');
                                 }
                                 return nodeRepository.addNodeAttribute(network.nodeID, 'node_about', JSON.stringify({
                                     node_version    : NODE_MILLIX_VERSION,
                                     node_create_date: versionInfo.create_date,
                                     node_update_date: NODE_MILLIX_BUILD_DATE
                                 }));
                             });
          })
          .then(() => { // update peer_connection
              return database.getRepository('node')
                             .getConnectionStatistics()
                             .then(connectionStats => {
                                 return nodeRepository.addNodeAttribute(network.nodeID, 'peer_connection', JSON.stringify(connectionStats));
                             });
          }).then(() => { // update transaction_fee
                return nodeRepository.addNodeAttribute(network.nodeID, 'transaction_fee', JSON.stringify({
                    transaction_fee_default: config.TRANSACTION_FEE_DEFAULT,
                    transaction_fee_network: config.TRANSACTION_FEE_NETWORK,
                    transaction_fee_proxy  : config.TRANSACTION_FEE_PROXY
                }));
            }).then(() => {
                return new Promise(resolve => {
                    let attributes = [];
                    async.eachSeries([
                        'shard_protocol',
                        'transaction_count',
                        'transaction_fee',
                        'peer_count',
                        'address_default',
                        'node_about',
                        'peer_connection'
                    ], (attributeType, callback) => {
                        database.getRepository('node')
                                .getNodeAttribute(network.nodeID, attributeType)
                                .then(attributeValue => {
                                    if (attributeValue) {
                                        attributes.push({
                                            node_id       : network.nodeID,
                                            attribute_type: attributeType,
                                            value         : attributeValue
                                        });
                                    }
                                    callback();
                                });
                    }, () => {
                        async.eachLimit(network.registeredClients, 4, (ws, wsCallback) => {
                            attributes.forEach(attribute => {
                                peer.nodeAttributeResponse(attribute, ws);
                            });
                            setTimeout(wsCallback, 250);
                        }, () => resolve());
                    });
                });
            });
    }

    _doDAGProgress() {
        return new Promise(resolve => {
            database.getRepository('keychain').getWalletAddresses(this.getDefaultActiveWallet())
                    .then((addresses) => {
                        let address = _.sample(addresses);
                        if (!address) {
                            return resolve();
                        }
                        this.addTransaction([
                            {
                                address_base          : address.address_base,
                                address_version       : address.address_version,
                                address_key_identifier: address.address_key_identifier,
                                amount                : 1
                            }
                        ], {
                            fee_type: 'transaction_fee_default',
                            amount  : 1
                        }).then((transactionList) => {
                            transactionList.forEach(transaction => this._checkIfWalletUpdate(new Set(_.map(transaction.transaction_output_list, o => o.address_key_identifier))));
                            resolve();
                        }).catch(() => resolve());
                    });
        });
    }

    getWalletAddresses() {
        return database.getRepository('keychain').getWalletAddresses(this.getDefaultActiveWallet());
    }

    _onTransactionValidationRequest(data, ws) {
        walletTransactionConsensus.processTransactionValidationRequest(data, ws);
    }

    _onTransactionValidationResponse(data, ws) {
        walletTransactionConsensus.processTransactionValidationResponse(data, ws);
    }

    _onTransactionProxyRequest(data, ws) {
        if (mutex.getKeyQueuedSize(['transaction-proxy-request']) > 0) {
            peer.transactionProxyResponse({
                transaction_id         : data.transaction_id,
                transaction_input_chain: []
            }, ws);
            return;
        }

        mutex.lock(['transaction-proxy-request'], unlock => {
            database.getRepository('transaction')
                    .getTransactionInputChain(data)
                    .then(inputChain => {
                        peer.transactionProxyResponse({
                            transaction_id         : data.transaction_id,
                            transaction_input_chain: inputChain
                        }, ws);
                        unlock();
                    });
        });
    }

    _onTransactionProxy(data, ws) {
        let transactionList, proxyTimeLimit;
        if (!(data instanceof Array)) {
            transactionList = data.transaction_list;
            proxyTimeLimit  = data.proxy_time_limit;
        }
        else { //TODO: remove in future versions
            transactionList = data;
            proxyTimeLimit  = 30000;
        }
        const proxyTimeStart = Date.now();
        const {connectionID} = ws;
        // check proxy fee
        const feeTransaction = transactionList[transactionList.length - 1];
        const feeOutput      = _.find(feeTransaction.transaction_output_list, {output_position: -1});
        if (!feeOutput || feeOutput.amount < config.TRANSACTION_FEE_PROXY || feeOutput.address_key_identifier !== this.defaultKeyIdentifier) {
            return peer.transactionProxyResult({
                transaction_proxy_fail   : 'invalid_fee_output',
                transaction_id           : transactionList[0].transaction_id,
                transaction_proxy_success: false
            }, network.getWebSocketByID(connectionID));
        }
        let pipeline = Promise.resolve();
        for (let transaction of transactionList) {
            if (transaction.shard_id !== genesisConfig.genesis_shard_id) {
                return peer.transactionProxyResult({
                    transaction_proxy_fail   : 'invalid_transaction',
                    transaction_id           : transaction.transaction_id,
                    transaction_proxy_success: false
                }, network.getWebSocketByID(connectionID));
            }

            walletTransactionConsensus.addTransactionToCache(transaction);
            pipeline = pipeline.then(() => walletTransactionConsensus._validateTransaction(transaction, undefined, 0, new Set(), new Set(), proxyTimeStart, proxyTimeLimit));
        }

        transactionList.forEach(transaction => {
            pipeline = pipeline.then(() => {
                console.log('[wallet][proxy] transaction ', transaction.transaction_id, ' was validated and proxied');
                let ws = network.getWebSocketByID(connectionID);
                return this._onNewTransaction(transaction, ws, true);
            }).then(() => {
                walletTransactionConsensus.removeFromRejectedTransactions(transaction.transaction_id);
                console.log('[wallet][proxy] transaction ', transaction.transaction_id, ' stored');
            });
        });

        const transaction = transactionList[0];
        pipeline.then(() => {
            const ws = network.getWebSocketByID(connectionID);
            if (ws) {
                peer.transactionProxyResult({
                    transaction_id           : transaction.transaction_id,
                    transaction_proxy_success: true
                }, ws);
            }
        }).catch((err) => {
            transactionList.forEach(transaction => walletTransactionConsensus.removeFromRejectedTransactions(transaction.transaction_id));
            console.log('[wallet][proxy] rejected: ', err);
            const ws = network.getWebSocketByID(connectionID);

            if (err.cause === 'consensus_timeout') {
                return;
            }
            else if (err.cause === 'transaction_not_found') {
                ws && peer.transactionSyncByWebSocket(err.transaction_id_fail, ws).then(_ => _);
                this.requestTransactionFromNetwork(err.transaction_id_fail);
            }

            if (ws) {
                peer.transactionProxyResult({
                    ...err,
                    transaction_id           : transaction.transaction_id,
                    transaction_proxy_success: false
                }, ws);
            }
        });
    }

    _onNewPeerConnection(ws) {
        if (this.initialized) {
            this.syncWalletTransactions(ws).then(_ => _);
        }
    }

    _onPeerConnectionClosed(ws) {
    }

    _doShardZeroPruning() {
        return new Promise(resolve => {
            mutex.lock(['shard-zero-pruning'], unlock => {

                return database.getRepository('keychain')
                               .getWalletKnownKeyIdentifier()
                               .then(knownKeyIdentifierSet => {
                                   config.EXTERNAL_WALLET_KEY_IDENTIFIER.forEach(externalKeyIdentifier => knownKeyIdentifierSet.add(externalKeyIdentifier));
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

    _doStateInspector() {
        let networkTransactions = _.keys(this._transactionReceivedFromNetwork);
        console.log('[wallet] status (_transactionReceivedFromNetwork:', networkTransactions.length, ' | _transactionValidationRejected:', walletTransactionConsensus.getRejectedTransactionList().size, ' | _activeConsensusRound:', _.keys(this._activeConsensusRound).length + ')');

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

    _doTransactionOutputExpiration() {
        if (mutex.getKeyQueuedSize(['transaction-output-expiration']) > 0) {
            return Promise.resolve();
        }

        return new Promise(resolve => {
            console.log('[Wallet] Starting transaction output expiration');
            mutex.lock(['transaction-output-expiration'], unlock => {
                let time = ntp.now();
                time.setMinutes(time.getMinutes() - config.TRANSACTION_OUTPUT_EXPIRE_OLDER_THAN);

                return database.getRepository('transaction').expireTransactions(time, [
                    this.defaultKeyIdentifier,
                    ...config.EXTERNAL_WALLET_KEY_IDENTIFIER
                ])
                               .then(() => {
                                   eventBus.emit('wallet_update');
                                   unlock();
                                   resolve();
                               });
            });
        });
    }

    _tryProxyTransaction(proxyCandidateData, srcInputs, dstOutputs, outputFee, addressAttributeMap, privateKeyMap, transactionVersion, propagateTransaction = true) {
        const addressRepository = database.getRepository('address');
        const time              = ntp.now();

        const transactionDate = new Date(Math.floor(time.getTime() / 1000) * 1000);
        const {
                  address: addressBase,
                  version,
                  identifier: addressKeyIdentifier
              }               = addressRepository.getAddressComponent(proxyCandidateData.node_address_default);
        let feeOutputs        = [
            {
                ...outputFee,
                node_id_proxy         : proxyCandidateData.node_id,
                address_base          : addressBase,
                address_version       : version,
                address_key_identifier: addressKeyIdentifier
            }
        ];
        return walletUtils.signTransaction(srcInputs, dstOutputs, feeOutputs, addressAttributeMap, privateKeyMap, transactionDate, transactionVersion)
                          .then(transactionList => ([
                              transactionList,
                              proxyCandidateData
                          ]))
                          .then(([transactionList, proxyCandidateData]) => {
                              if (this._transactionSendInterrupt) {
                                  return Promise.reject('transaction_send_interrupt');
                              }
                              return peer.transactionProxyRequest(transactionList, proxyCandidateData);
                          })
                          .then(([transactionList, proxyResponse, proxyWS]) => {
                              const chainFromProxy = proxyResponse.transaction_input_chain;
                              if (this._transactionSendInterrupt) {
                                  return Promise.reject('transaction_send_interrupt');
                              }
                              else if (chainFromProxy.length === 0) {
                                  return Promise.reject('invalid_proxy_transaction_chain');
                              }
                              return propagateTransaction ? peer.transactionProxy(transactionList, config.TRANSACTION_TIME_LIMIT_PROXY, proxyWS) : transactionList;
                          })
                          .then(transactionList => {
                              let pipeline = new Promise(resolve => resolve(true));
                              transactionList.forEach(transaction => pipeline = pipeline.then(isValid => isValid ? walletUtils.verifyTransaction(transaction).catch(() => new Promise(resolve => resolve(false))) : false));
                              return pipeline.then(isValid => !isValid ? Promise.reject('tried to sign and store and invalid transaction') : transactionList);
                          });
    };

    proxyTransaction(srcInputs, dstOutputs, outputFee, addressAttributeMap, privateKeyMap, transactionVersion, propagateTransaction = true) {
        const transactionRepository = database.getRepository('transaction');
        const proxyErrorList        = [
            'proxy_network_error',
            'proxy_timeout',
            'invalid_proxy_transaction_chain',
            'proxy_connection_state_invalid',
            'transaction_proxy_rejected',
            'proxy_time_limit_exceed'
        ];
        return transactionRepository.getPeersAsProxyCandidate(_.uniq(_.map(network.registeredClients, ws => ws.nodeID)))
                                    .then(proxyCandidates => {
                                        return new Promise((resolve, reject) => {
                                            async.eachSeries(proxyCandidates, (proxyCandidateData, callback) => {
                                                this._tryProxyTransaction(proxyCandidateData, srcInputs, dstOutputs, outputFee, addressAttributeMap, privateKeyMap, transactionVersion, propagateTransaction)
                                                    .then(transaction => callback({
                                                        error: false,
                                                        transaction
                                                    }))
                                                    .catch(e => typeof e === 'string' && !proxyErrorList.includes(e) ? callback({
                                                        error  : true,
                                                        message: e
                                                    }) : callback());
                                            }, data => {
                                                if (data && data.error && typeof data.message === 'string' && !proxyErrorList.includes(data.message)) {
                                                    reject(data.message);
                                                }
                                                else if (data && data.transaction) {
                                                    resolve(data.transaction);
                                                }
                                                else {
                                                    if (data && data.error && typeof data.message === 'string' && data.message === 'transaction_proxy_rejected') {
                                                        reject('transaction_proxy_rejected');
                                                    }
                                                    else {
                                                        reject('proxy_not_found');
                                                    }
                                                }
                                            });
                                        });
                                    });
    }

    signAndStoreTransaction(srcInputs, dstOutputs, outputFee, addressAttributeMap, privateKeyMap, transactionVersion) {
        const transactionRepository = database.getRepository('transaction');
        return this.proxyTransaction(srcInputs, dstOutputs, outputFee, addressAttributeMap, privateKeyMap, transactionVersion, true)
                   .then(transactionList => {
                       // store the transaction
                       let pipeline = Promise.resolve();
                       transactionList.forEach(transaction => {
                           transaction.transaction_input_list.forEach(input => cache.setCacheItem('wallet', `is_spend_${input.output_transaction_id}_${input.output_position}`, true, 300000));
                           const dbTransaction            = _.cloneDeep(transaction);
                           dbTransaction.transaction_date = new Date(dbTransaction.transaction_date * 1000).toISOString();
                           pipeline                       = pipeline.then(() => transactionRepository.addTransactionFromObject(dbTransaction, this.transactionHasKeyIdentifier(dbTransaction)));
                       });
                       return pipeline.then(() => transactionList);
                   })
                   .then(transactionList => {
                       // register first
                       // address to the
                       // dht for receiving
                       // proxy fees
                       const address = _.pick(srcInputs[0], [
                           'address_base',
                           'address_version',
                           'address_key_identifier'
                       ]);
                       network.addAddressToDHT(address, base58.decode(addressAttributeMap[address.address_base].key_public).slice(1, 33), Buffer.from(privateKeyMap[address.address_base], 'hex'));
                       return transactionList;
                   });
    }

    updateDefaultAddressAttribute() {
        let nodeRepository    = database.getRepository('node');
        let addressRepository = database.getRepository('address');
        const defaultAddress  = this.defaultKeyIdentifier + addressRepository.getDefaultAddressVersion().version + this.defaultKeyIdentifier;
        return nodeRepository.addNodeAttribute(network.nodeID, 'address_default', defaultAddress);
    }

    _propagateTransactions() {
        const transactionRepository = database.getRepository('transaction');
        transactionRepository.getExpiredTransactions()
                             .then(transactions => {
                                 if (transactions.length > 0) {
                                     peer.propagateTransactionList(transactions);
                                 }
                             });
    }

    onPropagateTransactionList(data) {
        if (mutex.getKeyQueuedSize(['transaction-list-propagate']) > config.NODE_CONNECTION_OUTBOUND_MAX) {
            return Promise.resolve();
        }
        const {transaction_id_list: transactions} = data;
        if (transactions && transactions.length > 0) {
            mutex.lock(['transaction-list-propagate'], unlock => {
                async.eachSeries(transactions, (transaction, callback) => {
                    if (!!cache.getCacheItem('propagation', transaction.transaction_id)) {
                        return callback();
                    }
                    const transactionRepository = database.getRepository('transaction');
                    transactionRepository.hasTransaction(transaction.transaction_id)
                                         .then(hasTransaction => {
                                             if (!hasTransaction) {
                                                 peer.transactionSyncRequest(transaction.transaction_id, {
                                                     dispatch_request  : true,
                                                     force_request_sync: true
                                                 })
                                                     .then(_ => _)
                                                     .catch(_ => _);
                                             }
                                             else {
                                                 cache.setCacheItem('propagation', transaction.transaction_id, true, (transaction.transaction_date * 1000) + (config.TRANSACTION_OUTPUT_REFRESH_OLDER_THAN * 60 * 1000));
                                             }
                                             callback();
                                         });
                }, () => unlock());
            });
        }
    }

    _initializeEvents() {
        walletSync.initialize()
                  .then(() => walletTransactionConsensus.initialize())
                  .then(() => {
                      task.scheduleTask('transaction_propagate', this._propagateTransactions.bind(this), 10000);
                      eventBus.on('transaction_list_propagate', this.onPropagateTransactionList.bind(this));
                      eventBus.on('peer_connection_new', this._onNewPeerConnection.bind(this));
                      eventBus.on('peer_connection_closed', this._onPeerConnectionClosed.bind(this));
                      eventBus.on('transaction_new_request_proxy', this._onTransactionProxyRequest.bind(this));
                      eventBus.on('transaction_new_proxy', this._onTransactionProxy.bind(this));
                      eventBus.on('transaction_new', this._onNewTransaction.bind(this));
                      eventBus.on('transaction_sync', this._onSyncTransaction.bind(this));
                      eventBus.on('transaction_sync_response', this._onTransactionSyncResponse.bind(this));
                      eventBus.on('shard_sync_request', this._onSyncShard.bind(this));
                      eventBus.on('wallet_transaction_sync', this._onSyncWalletBalance.bind(this));
                      eventBus.on('wallet_transaction_sync_response', this._onSyncWalletBalanceResponse.bind(this));
                      eventBus.on('transaction_validation_start', this._onTransactionValidationRequest.bind(this));
                      eventBus.on('transaction_validation_response', this._onTransactionValidationResponse.bind(this));
                      eventBus.on('transaction_spend_request', this._onSyncTransactionSpendTransaction.bind(this));
                      eventBus.on('transaction_output_spend_request', this._onSyncOutputSpendTransaction.bind(this));
                      eventBus.on('transaction_output_spend_response', this._onSyncOutputSpendTransactionResponse.bind(this));
                  });
    }

    initialize(initializeEventsOnly, createWalletIfNotExists) {
        if (!initializeEventsOnly) {
            return this.getMnemonic(createWalletIfNotExists)
                       .then(([mnemonicPhrase, isNewMnemonic]) => {

                           if (mnemonicPhrase === undefined) { // not wallet found
                               return Promise.resolve(null);
                           }

                           return this.getWalletPrivateKey(mnemonicPhrase, isNewMnemonic).then(xPrivkey => [
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
                                      });
                       })
                       .then(walletID => {
                           if (!walletID) { // not wallet found
                               return new Promise((_, reject) => {
                                   console.log('[wallet] waiting for a new wallet to be created...');
                                   const error = {
                                       cause  : 'wallet_not_found',
                                       message: 'there is no wallet configured'
                                   };
                                   eventBus.emit('wallet_authentication_error', error);
                                   reject(error);
                               });
                           }

                           this._initializeEvents();
                           return database.getRepository('keychain').getWalletDefaultKeyIdentifier(walletID)
                                          .then(defaultKeyIdentifier => {
                                              this.defaultKeyIdentifier = defaultKeyIdentifier;
                                              return this._doTransactionOutputExpiration();
                                          })
                                          .then(() => {
                                              if (network.nodeID) {
                                                  this.updateDefaultAddressAttribute().then(_ => _);
                                              }
                                              else {
                                                  eventBus.once('network_ready', () => this.updateDefaultAddressAttribute().then(_ => _));
                                              }
                                              this.initialized = true;
                                              return walletID;
                                          });
                       })
                       .catch((err) => {
                           if (err && err.cause === 'wallet_not_found') {
                               return Promise.reject(err);
                           }
                           throw Error(`Could not initialize wallet ${err}`);
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
        eventBus.removeAllListeners('transaction_new_request_proxy');
        eventBus.removeAllListeners('transaction_new_proxy');
        eventBus.removeAllListeners('transaction_new');
        eventBus.removeAllListeners('transaction_sync');
        eventBus.removeAllListeners('transaction_sync_response');
        eventBus.removeAllListeners('shard_sync_request');
        eventBus.removeAllListeners('wallet_transaction_sync');
        eventBus.removeAllListeners('wallet_transaction_sync_response');
        eventBus.removeAllListeners('transaction_validation_request');
        eventBus.removeAllListeners('transaction_validation_response');
        eventBus.removeAllListeners('transaction_spend_request');
        eventBus.removeAllListeners('transaction_output_spend_request');
        eventBus.removeAllListeners('transaction_output_spend_response');
    }
}


export default new Wallet();
