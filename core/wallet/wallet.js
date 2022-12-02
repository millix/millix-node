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
import config from '../config/config';
import statsApi from '../../api/rKclyiLtHx0dx55M/index';
import network from '../../net/network';
import mutex from '../mutex';
import ntp from '../ntp';
import path from 'path';
import console from '../console';
import base58 from 'bs58';
import task from '../task';
import cache from '../cache';
import fileExchange from '../storage/file-exchange';
import fileSync from '../storage/file-sync';
import utils, {NodeVersion} from '../utils/utils';
import request from 'request';

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
        this.walletSyncTimeoutHandler        = undefined;
        this._lockProcessNewTransaction      = 0;
        this._maxBacklogThresholdReached     = false;
        this.initialized                     = false;
        this._transactionSendInterrupt       = false;
        this._activeShards                   = new Set();
        this._isSendingNewTransaction        = false;

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

    getCurrentWalletInfo() {
        let walletInfo = {
            network_initialized: network.initialized,
            node_id            : network.nodeID
        };

        if (this.initialized || !_.isEmpty(this.getActiveWallets())) {
            const keyIdentifier = this.defaultKeyIdentifier;
            return database.getRepository('address').getAddressBaseAttribute(keyIdentifier, 'key_public')
                           .then(publicKey => {
                               const addressVersion = database.getRepository('address').getDefaultAddressVersion().version;
                               return {
                                   address_key_identifier: keyIdentifier,
                                   address_version       : addressVersion,
                                   address_public_key    : publicKey,
                                   ...walletInfo
                               };
                           });
        }
        else {
            return new Promise((resolve) => {
                resolve(walletInfo);
            });
        }
    }

    getKeyIdentifier() {
        return this.defaultKeyIdentifier;
    }

    deriveAndSaveAddress(walletID, isChange, addressPosition, addressKeyIdentifier, status = 1) {
        const keychain = database.getRepository('keychain');
        let {
                address          : addressBase,
                address_attribute: addressAttribute
            }          = this.deriveAddress(walletID, isChange, addressPosition);
        return !!addressKeyIdentifier ?
               keychain.addAddress(walletID, isChange, addressPosition, addressBase,
                   database.getRepository('address').getDefaultAddressVersion().version,
                   addressKeyIdentifier || addressBase, addressAttribute, status)
                                      :
               keychain.getWalletDefaultKeyIdentifier(walletID)
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
        const keychain = database.getRepository('keychain');
        return keychain.activateAndGetNextAddress(walletID)
                       .catch(() => keychain.getNextAddressPosition(walletID)
                                            .then((addressPosition) => this.deriveAndSaveAddress(walletID, 0, addressPosition)))
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

    updateTransactionOutputWithAddressInformation(outputs) {
        const keychainRepository                 = database.getRepository('keychain');
        const addressRepository                  = database.getRepository('address');
        const outputAddressToAddressComponentMap = {};
        return keychainRepository.getAddressesByAddressBase(_.uniq(_.map(outputs, output => {
            const addressComponents                            = addressRepository.getAddressComponent(output.address);
            outputAddressToAddressComponentMap[output.address] = {
                address_base          : addressComponents.address,
                address_version       : addressComponents.version,
                address_key_identifier: addressComponents.identifier
            };
            return addressComponents.address; //address_base
        }))).then(addresses => {
            const addressBaseToAddressInfoMap = {};
            addresses.forEach(address => addressBaseToAddressInfoMap[address.address_base] = address);
            const outputToRemoveList = [];
            for (let i = 0; i < outputs.length; i++) {
                const output        = outputs[i];
                const outputAddress = outputAddressToAddressComponentMap[output.address];
                const addressInfo   = addressBaseToAddressInfoMap[outputAddress.address_base];
                if (!addressInfo) {
                    console.log('[wallet][warn] output address not found', output);
                    outputToRemoveList.push(output);
                }
                else {
                    output['address_version']        = outputAddress.address_version;
                    output['address_key_identifier'] = outputAddress.address_key_identifier;
                    output['address_base']           = outputAddress.address_base;
                    output['address_position']       = addressInfo.address_position;
                    output['address_attribute']      = addressInfo.address_attribute;
                }
            }

            _.pull(outputs, ...outputToRemoveList);

            return outputs;
        });
    }

    hasAnyWalletKeyIdentifierInTransactionOutputList(transaction, walletKeyIdentifiers = new Set()) {
        const transactionWalletKeyIdentifiers = new Set(_.map(transaction.transaction_output_list, o => o.address_key_identifier));
        return _.some(Array.from(transactionWalletKeyIdentifiers), keyIdentifier => walletKeyIdentifiers.has(keyIdentifier));
    }

    notifyTransactionChanged(transactionList, status) {

        const walletKeyIdentifiers = new Set([
            this.defaultKeyIdentifier,
            ...config.EXTERNAL_WALLET_KEY_IDENTIFIER
        ]);

        _.each(_.filter(transactionList, transaction => !walletUtils.isRefreshTransaction(transaction) && this.hasAnyWalletKeyIdentifierInTransactionOutputList(transaction, walletKeyIdentifiers)), transaction => this.notifyExternalAPI(transaction, status));
    }

    notifyExternalAPI(transaction, status) {
        request.get(`${config.EXTERNAL_API_NOTIFICATION}?p0=${transaction.transaction_id}&p1=${status}`, {
            strictSSL: false,
            encoding : null
        }, _ => _);
    }

    processTransaction(transactionFunction) {
        return new Promise((resolve, reject) => {
            mutex.lock(['write'], (unlock) => {
                this._isSendingNewTransaction  = true;
                this._transactionSendInterrupt = false;
                return transactionFunction()
                    .then(transactionList => {
                        transactionList.forEach(transaction => peer.transactionSend(transaction));
                        return transactionList;
                    })
                    .then((transactionList) => {
                        this._transactionSendInterrupt = false;
                        this._isSendingNewTransaction  = false;
                        this.notifyTransactionChanged(transactionList, 'transaction_new');
                        unlock();
                        resolve(transactionList);
                    })
                    .catch((e) => {
                        this._isSendingNewTransaction  = false;
                        this._transactionSendInterrupt = false;
                        unlock();
                        reject(e);
                        if (e.error === 'transaction_invalid' || (e.error === 'transaction_proxy_rejected' && (e.data.cause === 'transaction_double_spend' || e.data.cause === 'transaction_invalid'))) {
                            if (e?.transaction_list) {
                                const transactionsIDList = [];
                                e.transaction_list.forEach(transaction => {
                                    transactionsIDList.push(transaction.transaction_id);
                                    transaction.transaction_input_list.forEach(input => transactionsIDList.push(input.output_transaction_id));
                                });
                                this.resetValidation(transactionsIDList).then(_ => _);
                                this._doWalletUpdate();
                            }
                        }
                    });
            });
        });
    }

    aggregateOutputs(outputList) {
        return this.processTransaction(() => {
            return utils.orElsePromise(outputList, () => database.applyShards((shardID) => {
                const transactionRepository = database.getRepository('transaction', shardID);
                return new Promise((resolve, reject) => transactionRepository.getFreeOutput(this.defaultKeyIdentifier)
                                                                             .then(outputs => outputs.length ? resolve(outputs) : reject()));
            }).then((outputs) => {
                return this.updateTransactionOutputWithAddressInformation(_.filter(outputs, output => !cache.getCacheItem('wallet', `is_spend_${output.transaction_id}_${output.output_position}`)));
            })).then((outputs) => {
                if (!outputs || outputs.length === 0) {
                    return Promise.reject({
                        error: 'insufficient_balance',
                        data : {balance_stable: 0}
                    });
                }
                outputs = _.orderBy(outputs, ['amount'], [config.WALLET_AGGREGATION_CONSUME_SMALLER_FIRST ? 'asc' : 'desc']);

                const maxOutputsToUse     = config.WALLET_AGGREGATION_TRANSACTION_INPUT_COUNT;
                const outputsToUse        = [];
                const privateKeyMap       = {};
                const addressAttributeMap = {};
                let totalAmount           = 0;
                let lastAmount            = 0;
                let i                     = 0;

                for (; i < outputs.length && outputsToUse.length < maxOutputsToUse; i++) {
                    let output                               = outputs[i];
                    const extendedPrivateKey                 = this.getActiveWalletKey(this.getDefaultActiveWallet());
                    const privateKeyBuf                      = walletUtils.derivePrivateKey(extendedPrivateKey, 0, output.address_position);
                    privateKeyMap[output.address_base]       = privateKeyBuf.toString('hex');
                    addressAttributeMap[output.address_base] = output.address_attribute;
                    totalAmount                              = totalAmount + output.amount;
                    lastAmount                               = output.amount;
                    outputsToUse.push(output);
                }

                if (totalAmount <= config.TRANSACTION_FEE_PROXY) {
                    // we will replace the last output
                    // search for an output that matches the required amount
                    totalAmount          = totalAmount - lastAmount;
                    const requiredAmount = config.TRANSACTION_FEE_PROXY - totalAmount + 1;
                    for (; i < outputs.length; i++) {
                        let output = outputs[i];
                        if (output.amount < requiredAmount) {
                            continue;
                        }
                        const extendedPrivateKey                 = this.getActiveWalletKey(this.getDefaultActiveWallet());
                        const privateKeyBuf                      = walletUtils.derivePrivateKey(extendedPrivateKey, 0, output.address_position);
                        privateKeyMap[output.address_base]       = privateKeyBuf.toString('hex');
                        addressAttributeMap[output.address_base] = output.address_attribute;
                        totalAmount                              = totalAmount + output.amount;
                        outputsToUse[outputsToUse.length - 1]    = output; /* replace the last output*/
                    }
                }

                if (totalAmount <= config.TRANSACTION_FEE_DEFAULT) {
                    return Promise.reject({error: 'aggregation_not_possible'});
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
                    'address_key_identifier',
                    'amount'
                ]), (v, k) => keyMap[k] ? keyMap[k] : k));

                const outputFee = {
                    fee_type: 'transaction_fee_default'
                };

                return this.signAndStoreTransaction(srcInputs, [], outputFee, addressAttributeMap, privateKeyMap, config.WALLET_TRANSACTION_DEFAULT_VERSION, {}, true);
            });
        });
    }

    addTransaction(dstOutputs, outputFee, srcOutputs, transactionVersion, outputAttributes = {}) {
        return this.processTransaction(() => {
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
            }).then((outputs) => this.updateTransactionOutputWithAddressInformation(_.filter(outputs, output => !cache.getCacheItem('wallet', `is_spend_${output.transaction_id}_${output.output_position}`))))
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

                      if (i === config.TRANSACTION_INPUT_MAX) { /* we cannot add more inputs and still we did not aggregate the required amount for the transaction */
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
                      'address_key_identifier',
                      'amount'
                  ]), (v, k) => keyMap[k] ? keyMap[k] : k));

                  let amountSent     = _.sum(_.map(dstOutputs, o => o.amount)) + outputFee.amount;
                  let totalUsedCoins = _.sum(_.map(outputsToUse, o => o.amount));
                  let change         = totalUsedCoins - amountSent;
                  if (change > 0) {
                      let addressChange = outputs[outputs.length - 1];
                      dstOutputs.push({
                          address_base          : addressChange.address_base,
                          address_version       : database.getRepository('address').getDefaultAddressVersion().version,
                          address_key_identifier: addressChange.address_key_identifier,
                          amount                : change
                      });
                  }
                  return this.signAndStoreTransaction(srcInputs, dstOutputs, outputFee, addressAttributeMap, privateKeyMap, transactionVersion || config.WALLET_TRANSACTION_DEFAULT_VERSION, outputAttributes);
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
        this.walletSyncTimeoutHandler = setTimeout(() => cache.removeCacheItem('wallet', 'is_wallet_transaction_synced'), 60000); /* 60 second timeout then request sync from another peer*/

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
            this._doWalletUpdate();
        }
    }

    _doWalletUpdate() {
        eventBus.emit('wallet_update');
        // start consensus in 1s
        setTimeout(() => walletTransactionConsensus.doValidateTransaction(), 1000);
        statsApi.clearCacheItem('wallet_balance');
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
                           .getReceivedTransactionOutputCountByAddressKeyIdentifier(this.defaultKeyIdentifier);
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
        return this.resetValidation([transactionID]);
    }

    resetValidationOnLeafTransactions() {
        walletTransactionConsensus.resetTransactionValidationRejected();
        database.applyShards(shardID => {
            const transactionRepository = database.getRepository('transaction', shardID);
            return transactionRepository.listWalletLeafTransactions(this.defaultKeyIdentifier)
                                        .then(transactions => transactionRepository.getFreeOutput(this.defaultKeyIdentifier).then(freeOutput => [
                                            ...transactions,
                                            ...freeOutput
                                        ]));
        }).then(transactions => this.resetValidation(new Set(_.map(transactions, t => t.transaction_id))));
    }

    resetValidation(transactions) {
        return new Promise((resolve) => {
            async.eachSeries(transactions, (transactionID, callback) => {
                database.applyShards(shardID => {
                    const transactionRepository = database.getRepository('transaction', shardID);
                    walletTransactionConsensus.removeFromRetryTransactions(transactionID);
                    walletTransactionConsensus.removeFromRejectedTransactions(transactionID);
                    return transactionRepository.resetTransaction(transactionID);
                }).then(() => callback()).catch(() => callback());
            }, () => {
                resolve();
                statsApi.clearCache();
            });
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

        let node        = ws.node;
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
                       return database.firstShardZeroORShardRepository('transaction', transaction.shard_id, transactionRepository => {
                           return transactionRepository.hasTransaction(transaction.transaction_id)
                                                       .then(hasTransaction => hasTransaction ? Promise.resolve(true) : Promise.reject());
                       }).then(hasTransaction => {
                           if (hasTransaction && isRequestedBySync) {
                               return database.firstShardZeroORShardRepository('transaction', transaction.shard_id, transactionRepository => {
                                   return transactionRepository.getTransactionObject(transaction.transaction_id)
                                                               .then(transactionObject => !!transactionObject ? Promise.resolve(true) : Promise.reject());
                               });
                           }
                           return hasTransaction;
                       }).then(hasTransaction => {

                           if (hasTransaction) {
                               delete this._transactionReceivedFromNetwork[transaction.transaction_id];
                               delete this._transactionRequested[transaction.transaction_id];
                               delete this._transactionFundingActiveWallet[transaction.transaction_id];
                               return eventBus.emit('transaction_new:' + transaction.transaction_id, transaction);
                           }

                           return walletUtils.verifyTransaction(transaction)
                                             .then(([validTransaction, invalidTransactionError]) => {

                                                 if (!validTransaction && invalidTransactionError !== 'transaction_consume_expired_output') {
                                                     console.log('[wallet] invalid transaction received from network');
                                                     delete this._transactionReceivedFromNetwork[transaction.transaction_id];
                                                     delete this._transactionRequested[transaction.transaction_id];
                                                     delete this._transactionFundingActiveWallet[transaction.transaction_id];
                                                     walletSync.removeTransactionSync(transaction.transaction_id);
                                                     return null;
                                                 }

                                                 const isFundingWallet = !!this._transactionFundingActiveWallet[transaction.transaction_id];
                                                 const syncPriority    = isFundingWallet ? 1 : this.getTransactionSyncPriority(transaction);
                                                 delete this._transactionFundingActiveWallet[transaction.transaction_id];

                                                 if (syncPriority === 1) {
                                                     console.log(`[wallet] wallet-key-identifier >> transaction found ${transaction.transaction_id}`);
                                                 }

                                                 let transactionRepository = database.getRepository('transaction');

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
                                                 transaction.transaction_input_list.forEach(input => cache.setCacheItem('wallet', `is_spend_${input.output_transaction_id}_${input.output_position}`, true, 660000));
                                                 return transactionRepository.addTransactionFromObject(transaction, hasKeyIdentifier)
                                                                             .then(() => {
                                                                                 console.log('[Wallet] Removing ', transaction.transaction_id, ' from network transaction cache');
                                                                                 eventBus.emit('transaction_new:' + transaction.transaction_id, transaction);
                                                                                 this._checkIfWalletUpdate(new Set(_.map(transaction.transaction_output_list, o => o.address_key_identifier)));
                                                                                 this.notifyTransactionChanged([transaction], 'transaction_new');

                                                                                 eventBus.emit('wallet_event_log', {
                                                                                     type   : 'transaction_new',
                                                                                     content: data,
                                                                                     from   : node
                                                                                 });

                                                                                 walletSync.clearTransactionSync(transaction.transaction_id);

                                                                                 walletSync.syncTransactionSpendingOutputs(transaction, config.MODE_NODE_SYNC_FULL);
                                                                                 if (config.MODE_NODE_SYNC_FULL || hasKeyIdentifier) {
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
                                                                                     }
                                                                                 }

                                                                                 if (config.MODE_NODE_SYNC_FULL) {
                                                                                     this.transactionSpendRequest(transaction.transaction_id, syncPriority).then(_ => _).catch(_ => _);
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

                                                                                 if (hasKeyIdentifier) {
                                                                                     setTimeout(() => walletTransactionConsensus.doValidateTransaction(), 0);
                                                                                 }


                                                                                 const versionType = transaction.version.charAt(1);
                                                                                 if ((config.MODE_STORAGE_SYNC_FULL || fileSync.hasPendingSync(transaction.transaction_id) || (config.MODE_STORAGE_SYNC && hasKeyIdentifier)) &&
                                                                                     (versionType === 'a' || versionType === 'b') &&
                                                                                     parseInt(transaction.version.substring(2, transaction.version.length - 1)) >= 3 &&
                                                                                     transaction.transaction_output_attribute.transaction_output_metadata?.file_list?.length > 0) {
                                                                                     fileExchange.addTransactionToSyncQueue(transaction, fileSync.getPendingSyncOptions(transaction.transaction_id));
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
                                database.applyShards(shardID => {
                                    const transactionRepository = database.getRepository('transaction', shardID);
                                    return transactionRepository.deleteTransaction(transaction.transaction_id);
                                }).then(_ => this.requestTransactionFromNetwork(transaction.transaction_id, {
                                    priority        : 1,
                                    dispatch_request: true
                                }));
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
                else if (config.MODE_NODE_SYNC_FULL) {
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
        clearTimeout(this.walletSyncTimeoutHandler);
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
                        peer.transactionSyncRequest(transactionID, {
                            priority        : 1,
                            dispatch_request: true
                        })
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
            this._syncTransactionIfMissing(transactionID)
                .then(() => database.applyShards((shardID) => {
                    const transactionRepository = database.getRepository('transaction', shardID);
                    return transactionRepository.getSpendTransactions(transactionID);
                })).then(transactions => {
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

    _syncTransactionIfMissing(transactionID) {
        if (!config.MODE_NODE_SYNC_FULL) {
            return Promise.resolve();
        }

        return database.firstShards((shardID) => {
            const transactionRepository = database.getRepository('transaction', shardID);
            return transactionRepository.hasTransaction(transactionID);
        }).then(hasTransaction => {
            if (!hasTransaction) {
                this.requestTransactionFromNetwork(transactionID, {
                    priority        : 1,
                    dispatch_request: true
                });
            }
        });
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

            this._syncTransactionIfMissing(transactionID)
                .then(() => database.applyShards((shardID) => {
                    const transactionRepository = database.getRepository('transaction', shardID);
                    return transactionRepository.listTransactionInput({
                        output_transaction_id: transactionID,
                        output_position      : transactionOutputPosition
                    });
                })).then(spendingTransactions => {
                // get transaction objects
                async.mapSeries(spendingTransactions, (spendingTransaction, callback) => {
                    database.firstShardZeroORShardRepository('transaction', spendingTransaction.shard_id, transactionRepository => {
                        return transactionRepository.getTransactionObject(spendingTransaction.transaction_id)
                                                    .then(transaction => {
                                                        if (!transaction) {
                                                            return Promise.reject();
                                                        }

                                                        transaction = transactionRepository.normalizeTransactionObject(transaction);
                                                        if (!transaction) {
                                                            return database.applyShards(shardID => {
                                                                const transactionRepository = database.getRepository('transaction', shardID);
                                                                return transactionRepository.deleteTransaction(spendingTransaction.transaction_id);
                                                            }).then(_ => this.requestTransactionFromNetwork(spendingTransaction.transaction_id, {
                                                                priority        : 1,
                                                                dispatch_request: true
                                                            })).then(() => Promise.reject());
                                                        }

                                                        return transaction;
                                                    });
                    }).then(transaction => callback(null, transaction));
                }, (err, transactions) => {
                    // get peers' current web socket
                    let ws = network.getWebSocketByID(connectionID);
                    if (ws) {
                        peer.transactionOutputSpendResponse(transactionID, transactionOutputPosition, _.filter(transactions, i => !_.isNil(i)), ws);
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
                                     node_version    : config.NODE_MILLIX_VERSION,
                                     node_create_date: versionInfo.create_date,
                                     node_update_date: config.NODE_MILLIX_BUILD_DATE
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
                    }, () => resolve());
                });
            });
    }

    _doAutoAggregateTransaction() {
        if (this._isSendingNewTransaction || !config.WALLET_AGGREGATION_AUTO_ENABLED) {
            return Promise.resolve();
        }

        return database.applyShards((shardID) => {
            const transactionRepository = database.getRepository('transaction', shardID);
            return new Promise((resolve, reject) => transactionRepository.getFreeOutput(this.defaultKeyIdentifier)
                                                                         .then(outputs => outputs.length ? resolve(outputs) : reject()));
        }).then((outputs) => {
            return this.updateTransactionOutputWithAddressInformation(_.filter(outputs, output => !cache.getCacheItem('wallet', `is_spend_${output.transaction_id}_${output.output_position}`)));
        }).then(outputs => {
            if (outputs.length >= config.WALLET_AGGREGATION_AUTO_OUTPUT_MIN) {
                return this.aggregateOutputs(outputs);
            }
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

        const now    = Math.floor(ntp.now().getTime() / 1000);
        let pipeline = Promise.resolve();
        for (let transaction of transactionList) {
            if (transaction.shard_id !== genesisConfig.genesis_shard_id) {
                return peer.transactionProxyResult({
                    cause                    : 'invalid transaction shard',
                    transaction_proxy_fail   : 'invalid_transaction',
                    transaction_id           : transaction.transaction_id,
                    transaction_proxy_success: false
                }, network.getWebSocketByID(connectionID));
            }
            else if (transaction.transaction_date >= (now + config.TRANSACTION_CLOCK_SKEW_TOLERANCE)) { //clock skew: 10 seconds ahead
                return peer.transactionProxyResult({
                    cause                    : 'invalid transaction date',
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
            else if (err.cause === 'transaction_not_found' && config.MODE_NODE_SYNC_FULL) {
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
                let time = ntp.now().getTime() - config.TRANSACTION_OUTPUT_EXPIRE_OLDER_THAN * 60 * 1000;

                return database.getRepository('transaction').expireTransactions(Math.floor(time / 1000), [
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

    _tryProxyTransaction(proxyCandidateData, srcInputs, dstOutputs, outputFee, addressAttributeMap, privateKeyMap, transactionVersion, propagateTransaction = true, outputAttributes = {}, isAggregationTransaction = false) {
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
        return (!isAggregationTransaction ? walletUtils.signTransaction(srcInputs, dstOutputs, feeOutputs, addressAttributeMap, privateKeyMap, transactionDate, transactionVersion, outputAttributes)
                                          : walletUtils.signAggregationTransaction(srcInputs, feeOutputs, addressAttributeMap, privateKeyMap, transactionDate, transactionVersion, config.WALLET_AGGREGATION_TRANSACTION_INPUT_COUNT, config.WALLET_AGGREGATION_TRANSACTION_OUTPUT_COUNT, config.WALLET_AGGREGATION_TRANSACTION_MAX))
            .catch(e => Promise.reject({error: e}))
            .then((transactionList) => {
                if (this._transactionSendInterrupt) {
                    return Promise.reject({error: 'transaction_send_interrupt'});
                }
                return peer.transactionProxyRequest(transactionList, proxyCandidateData);
            })
            .then(([transactionList, proxyResponse, proxyWS]) => {
                const chainFromProxy = proxyResponse.transaction_input_chain;
                if (this._transactionSendInterrupt) {
                    return Promise.reject({error: 'transaction_send_interrupt'});
                }
                else if (chainFromProxy.length === 0) {
                    return Promise.reject({error: 'invalid_proxy_transaction_chain'});
                }

                if (propagateTransaction) {
                    return peer.transactionProxy(transactionList, config.TRANSACTION_TIME_LIMIT_PROXY, proxyWS)
                               .catch(e => {
                                   if (e.error === 'transaction_proxy_rejected') {
                                       return Promise.reject({
                                           ...e,
                                           transaction_list: transactionList
                                       });
                                   }
                                   else {
                                       return Promise.reject(e);
                                   }
                               });
                }
                else {
                    return transactionList;
                }
            })
            .then(transactionList => {
                let pipeline = new Promise(resolve => resolve(true));
                transactionList.forEach(transaction => pipeline = pipeline.then(isValid => isValid ? walletUtils.verifyTransaction(transaction).catch(() => new Promise(resolve => resolve(false))) : false));
                return pipeline.then(([isValid]) => !isValid ? Promise.reject({
                    error           : 'transaction_invalid',
                    cause           : 'tried to sign and store and invalid transaction',
                    transaction_list: transactionList
                }) : transactionList);
            });
    };

    proxyTransaction(srcInputs, dstOutputs, outputFee, addressAttributeMap, privateKeyMap, transactionVersion, propagateTransaction = true, outputAttributes = {}, isAggregationTransaction = false) {
        const transactionRepository = database.getRepository('transaction');
        const proxyErrorList        = [
            'proxy_network_error',
            'proxy_timeout',
            'invalid_proxy_transaction_chain',
            'proxy_connection_state_invalid',
            'proxy_time_limit_exceed'
        ];
        const minNodeVersion        = new NodeVersion(1, 22, 1);
        return transactionRepository.getPeersAsProxyCandidate(_.uniq(_.map(_.filter(network.registeredClients, ws => NodeVersion.ofNullable(NodeVersion.fromString(ws.features.version)).compareTo(minNodeVersion) >= 0), ws => ws.nodeID)))
                                    .then(proxyCandidates => {
                                        return new Promise((resolve, reject) => {
                                            async.eachSeries(proxyCandidates, (proxyCandidateData, callback) => {
                                                this._tryProxyTransaction(proxyCandidateData, srcInputs, dstOutputs, outputFee, addressAttributeMap, privateKeyMap, transactionVersion, propagateTransaction, outputAttributes, isAggregationTransaction)
                                                    .then(transaction => callback({transaction}))
                                                    .catch(e => {
                                                        if (!e
                                                            || (e.data && e.error === 'transaction_proxy_rejected' && e.data.cause !== 'transaction_double_spend' && e.data.cause !== 'transaction_invalid')
                                                            || proxyErrorList.includes(e.error)) {
                                                            callback();
                                                        }
                                                        else {
                                                            callback(e);
                                                        }
                                                    });
                                            }, data => {
                                                if (data && data.error && !proxyErrorList.includes(data.error)) {
                                                    reject(data);
                                                }
                                                else if (data && data.transaction) {
                                                    resolve(data.transaction);
                                                }
                                                else {
                                                    reject({error: 'proxy_not_found'});
                                                }
                                            });
                                        });
                                    });
    }

    signAndStoreTransaction(srcInputs, dstOutputs, outputFee, addressAttributeMap, privateKeyMap, transactionVersion, outputAttributes = {}, isAggregationTransaction = false) {
        const transactionRepository = database.getRepository('transaction');
        return new Promise((resolve, reject) => {
            this.proxyTransaction(srcInputs, dstOutputs, outputFee, addressAttributeMap, privateKeyMap, transactionVersion, true, outputAttributes, isAggregationTransaction)
                .catch(e => {
                    reject(e);
                    return Promise.reject(e);
                })
                .then(transactionList => {
                    resolve(transactionList); /* the transaction was propagated. we can return success (resume function call) and then store it into the db.*/
                    // store the transaction
                    let pipeline = Promise.resolve();
                    transactionList.forEach(transaction => {
                        transaction.transaction_input_list.forEach(input => cache.setCacheItem('wallet', `is_spend_${input.output_transaction_id}_${input.output_position}`, true, 660000));
                        const dbTransaction            = _.cloneDeep(transaction);
                        dbTransaction.transaction_date = new Date(dbTransaction.transaction_date * 1000).toISOString();
                        pipeline                       = pipeline.then(() => transactionRepository.addTransactionFromObject(dbTransaction, this.transactionHasKeyIdentifier(dbTransaction)));
                    });
                    return pipeline.then(() => transactionList);
                })
                .then(transactionList => {
                    this._doWalletUpdate();
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
                })
                .catch(e => console.log('[wallet] error on sign and store transaction', e));
        });
    }

    updateDefaultAddressAttribute() {
        let nodeRepository    = database.getRepository('node');
        let addressRepository = database.getRepository('address');
        const defaultAddress  = this.defaultKeyIdentifier + addressRepository.getDefaultAddressVersion().version + this.defaultKeyIdentifier;
        return nodeRepository.addNodeAttribute(network.nodeID, 'address_default', defaultAddress)
                             .then(() => nodeRepository.addNodeAttribute(network.nodeID, 'address_default_key_public', this.defaultKeyIdentifierPublicKey));
    }

    _propagateTransactions() {
        const transactionRepository = database.getRepository('transaction');
        transactionRepository.getTransactionsNotHibernated()
                             .then(transactions => {
                                 if (transactions.length > 0) {
                                     peer.propagateTransactionList(transactions);
                                 }
                             });
    }

    onPropagateTransactionList(data) {
        const {transaction_id_list: transactions} = data;
        if (transactions && transactions.length > 0) {
            mutex.lock(['transaction-list-propagate'], unlock => {
                async.eachSeries(transactions, (transaction, callback) => {
                    if (!!cache.getCacheItem('propagation', transaction.transaction_id) ||
                        walletSync.hasPendingTransaction(transaction.transaction_id)) {
                        return callback();
                    }
                    else {
                        peer.transactionSyncRequest(transaction.transaction_id, {
                            dispatch_request  : true,
                            force_request_sync: true
                        }).then(_ => _).catch(_ => _);
                        cache.setCacheItem('propagation', transaction.transaction_id, true, config.TRANSACTION_OUTPUT_REFRESH_OLDER_THAN * 60 * 1000);
                        callback();
                    }
                }, () => unlock());
            });
        }
    }

    _generateWalletAddresses() {
        this.isGeneratingWalletAddresses = true;
        const start                      = Date.now();
        const nAddresses                 = config.WALLET_ADDRESS_GENERATE_MAX;
        const concurrency                = 4;

        const keychain = database.getRepository('keychain');
        keychain.getNextAddressPosition(this.getDefaultActiveWallet())
                .then(nextAddressPosition => {

                    if (nextAddressPosition === undefined) {
                        nextAddressPosition = 0;
                    }

                    if (nextAddressPosition >= nAddresses) {
                        this.isGeneratingWalletAddresses = false;
                        return;
                    }

                    async.timesLimit(nAddresses - nextAddressPosition, concurrency, (i, callback) => {
                        const addressPosition = i + nextAddressPosition;
                        if (addressPosition % 1000 === 0 && addressPosition !== 0) {
                            console.log(`[wallet] took  ${(Date.now() - start) / 1000}s to process ${addressPosition} addresses`);
                        }
                        this.deriveAndSaveAddress(this.getDefaultActiveWallet(), 0, addressPosition, this.defaultKeyIdentifier, 0).catch(_ => _).then(() => callback());
                    }, () => {
                        console.log(`[wallet] took  ${(Date.now() - start) / 1000}s to process ${nAddresses} addresses`);
                        this.isGeneratingWalletAddresses = false;
                    });

                });
    }

    _initializeEvents() {
        walletSync.initialize()
                  .then(() => walletTransactionConsensus.initialize())
                  .then(() => {
                      task.scheduleTask('transaction_propagate', this._propagateTransactions.bind(this), 10000);
                      task.scheduleTask('auto_aggregate_transaction', this._doAutoAggregateTransaction.bind(this), 600000 /*10 min*/, true);
                      setTimeout(() => this._doAutoAggregateTransaction(), 150000 /*2.5 min*/);

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
                                              const extendedPrivateKey           = this.getActiveWalletKey(this.getDefaultActiveWallet());
                                              this.defaultKeyIdentifierPublicKey = base58.encode(walletUtils.derivePublicKey(extendedPrivateKey, 0, 0));
                                              this.defaultKeyIdentifier          = defaultKeyIdentifier;
                                              this._doTransactionOutputExpiration().then(_ => _).catch(_ => _);
                                          })
                                          .then(() => {
                                              if (network.nodeID) {
                                                  this.updateDefaultAddressAttribute().then(_ => _);
                                              }
                                              else {
                                                  eventBus.once('network_ready', () => this.updateDefaultAddressAttribute().then(_ => _));
                                              }
                                              this.initialized = true;

                                              this._generateWalletAddresses();

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
        task.removeTask('transaction_propagate');
        task.removeTask('auto_aggregate_transaction');
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
