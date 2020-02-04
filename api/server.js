// importing the dependencies
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import helmet from 'helmet';
import expressjwt from 'express-jwt';
import config from '../core/config/config';
import async from 'async';
import database from '../database/database';
import wallet from '../core/wallet/wallet';
import walletUtils from '../core/wallet/wallet-utils';
import network from '../net/network';
import _ from 'lodash';
import jwt from 'jsonwebtoken';
import Mnemonic from 'bitcore-mnemonic';
import base58 from 'bs58';


class Server {
    constructor() {
        this.started = false;
    }

    initialize() {
        return new Promise(resolve => {
            if (this.started) {
                return resolve();
            }

            this.started = true;

            const walletID              = _.first(Object.keys(wallet.getActiveWallets()));
            const keychainRepository    = database.getRepository('keychain');
            const addressRepository     = database.getRepository('address');
            const transactionRepository = database.getRepository('transaction');
            keychainRepository.getWalletAddresses(walletID)
                              .then(addresses => {
                                  let address = _.first(addresses);
                                  let secret  = base58.decode(address.address_attribute.key_public);

                                  // defining the Express app
                                  const app = express();

                                  const appInfo = {
                                      name   : 'millix',
                                      version: config.NODE_MILLIX_VERSION
                                  };

                                  // adding Helmet to enhance your API's
                                  // security
                                  app.use(helmet());

                                  // using bodyParser to parse JSON bodies into
                                  // JS objects
                                  app.use(bodyParser.json());

                                  // enabling CORS for all requests
                                  app.use(cors());

                                  // defining an endpoint to return all ads
                                  app.get('/', (req, res) => {
                                      res.send(appInfo);
                                  });

                                  app.post('/auth', (req, res) => {
                                      let data = req.body;
                                      wallet.getMnemonic()
                                            .then(([mnemonic_phrase, isNewMnemonic]) => {
                                                if (isNewMnemonic === true) {
                                                    res.send(401, 'Wallet not initialized');
                                                    return;
                                                }

                                                const mnemonic       = new Mnemonic(mnemonic_phrase);
                                                const masterKey      = mnemonic.toHDPrivateKey(data.passphrase);
                                                const account        = 0;
                                                const xPrivKey       = walletUtils.deriveExtendedPrivateKey(masterKey, account);
                                                const verifyWalletID = walletUtils.deriveWalletFromKey(xPrivKey);
                                                if (walletID !== verifyWalletID) {
                                                    res.send(401, 'Wrong authentication');
                                                    return;
                                                }

                                                const token = jwt.sign({wallet: walletID}, secret);
                                                res.send(token);
                                            });
                                  });

                                  app.use(expressjwt({secret: secret}));

                                  app.post('/peers',
                                      function(req, res) {
                                          let data = req.body;
                                          if (data.peers) {
                                              _.sampleSize(_.shuffle(data.peers), config.NODE_CONNECTION_OUTBOUND_MAX).forEach(node => network.addNode(node).catch(() => {
                                              }));
                                          }
                                      });

                                  app.get('/me/addresses',
                                      function(req, res) {
                                          let wallets = Object.keys(wallet.getActiveWallets());
                                          async.eachSeries(wallets, (walletID, callback) => {
                                              keychainRepository.getWalletAddresses(walletID)
                                                                .then(addresses => {
                                                                    res.send(addresses);
                                                                    callback();
                                                                });
                                          });
                                      });

                                  app.post('/me/addresses/new',
                                      function(req, res) {
                                          wallet.addNewAddress(walletID)
                                                .then(address => res.send(address));
                                      });

                                  app.get('/me/address/:address',
                                      function(req, res) {
                                          keychainRepository.getAddress(req.params.address)
                                                            .then(address => res.send(address));
                                      });

                                  app.post('/me/address/:address/transaction',
                                      function(req, res) {
                                          let data = req.body;
                                          wallet.addTransaction(req.params.address, data)
                                                .then(() => res.send({'status': 'OK'}))
                                                .catch(() => res.send({'status': 'ERROR'}));
                                      });

                                  app.get('/me/address/:address/balance',
                                      function(req, res) {
                                          addressRepository.getAddressBalance(req.params.address, true)
                                                           .then(stable => addressRepository.getAddressBalance(req.params.address, false)
                                                                                            .then(pending => res.send({
                                                                                                balance: {
                                                                                                    pending,
                                                                                                    stable
                                                                                                }
                                                                                            })));
                                      });

                                  app.get('/me/address/:address/stablebalance',
                                      function(req, res) {
                                          addressRepository.getAddressBalance(req.params.address, true)
                                                           .then(balance => res.send({balance}));
                                      });

                                  app.get('/me/address/:address/pendingbalance',
                                      function(req, res) {
                                          addressRepository.getAddressBalance(req.params.address, false)
                                                           .then(balance => res.send({balance}));
                                      });

                                  app.get('/address/:address',
                                      function(req, res) {
                                          addressRepository.getAddressBaseAttribute(req.params.address)
                                                           .then(address => res.send(address));
                                      });

                                  app.get('/status',
                                      function(req, res) {
                                          transactionRepository.getFreeTransactionsCount()
                                                               .then(transaction_free =>
                                                                   transactionRepository.getIncludedTransactionsCount()
                                                                                        .then(transaction_included =>
                                                                                            transactionRepository.getInputsCount()
                                                                                                                 .then(input =>
                                                                                                                     transactionRepository.getOutputsCount()
                                                                                                                                          .then(output =>
                                                                                                                                              addressRepository.getAddressesCount()
                                                                                                                                                               .then(address =>
                                                                                                                                                                   transactionRepository.getStableTransactionsCount()
                                                                                                                                                                                        .then(transaction_stable =>
                                                                                                                                                                                            transactionRepository.getPendingTransactionsCount()
                                                                                                                                                                                                                 .then(transaction_pending =>
                                                                                                                                                                                                                     res.send({
                                                                                                                                                                                                                         transaction_free,
                                                                                                                                                                                                                         transaction_included,
                                                                                                                                                                                                                         input,
                                                                                                                                                                                                                         output,
                                                                                                                                                                                                                         address,
                                                                                                                                                                                                                         transaction_stable,
                                                                                                                                                                                                                         transaction_pending
                                                                                                                                                                                                                     }))))))));
                                      });
                                  // starting the server
                                  app.listen(config.NODE_PORT_API, () => {
                                      console.log('API: listening on port ' + config.NODE_PORT_API);
                                  });
                                  resolve();
                              });
        });
    }
}


export default new Server();
