import console from './core/console';
import db from './database/database';
import wallet from './core/wallet/wallet';
import config from './core/config/config';
import genesisConfig from './core/genesis/genesis-config';
import request from 'request';
import services from './core/services/services';
import logManager from './core/log-manager';

const argv = require('yargs')
    .options({
        'initial-peers': {
            demandOption: false,
            array       : true
        }
    }).argv;

if (argv.initialPeers) {
    config.NODE_INITIAL_LIST = argv.initialPeers;
}

if (argv.port) {
    config.NODE_PORT = argv.port;
}

if (argv.apiPort) {
    config.NODE_PORT_API = argv.apiPort;
}

if (argv.host) {
    config.NODE_HOST = argv.host;
}

if (argv.testHost) {
    config.NODE_TEST_HOST = argv.testHost;
}

if (argv.testPort) {
    config.NODE_TEST_PORT = argv.testPort;
}

if (argv.dataFolder) {
    config.WALLET_KEY_PATH            = argv.dataFolder + 'millix_private_key.json';
    config.NODE_KEY_PATH              = argv.dataFolder + 'node.json';
    config.NODE_CERTIFICATE_KEY_PATH  = argv.dataFolder + 'node_certificate_key.pem';
    config.NODE_CERTIFICATE_PATH      = argv.dataFolder + 'node_certificate.pem';
    config.JOB_CONFIG_PATH            = argv.dataFolder + 'job.json';
    config.DATABASE_CONNECTION.FOLDER = argv.dataFolder;
}

let initGenesis = false;
if (argv.genesis) {
    initGenesis = argv.genesis;
}

if (argv.debug === "true") {
    config.MODE_DEBUG = true;
}

process.on('SIGINT', function() {
    console.log('\nGracefully shutting down from  SIGINT (Crtl-C)');
    return db.close();
});

process.on('exit', function() {
    return db.close();
});

console.log('starting millix-core');
db.initialize()
  .then(() => services.initialize())
  .then(() => {
      logManager.logSize = 1000;
      if (config.MODE_TEST) {
          request.post('http://' + config.NODE_TEST_HOST + ':' + config.NODE_TEST_PORT + '/ytgY8lWDDcEwL3PN', //node_register
              {
                  json: true,
                  body: {
                      ip_address: config.NODE_HOST,
                      api_port  : config.NODE_PORT_API,
                      port      : config.NODE_PORT,
                      prefix    : config.WEBSOCKET_PROTOCOL
                  }
              },
              (err, res, data) => {
                  genesisConfig.genesis_transaction = data.genesis;
                  console.log('registered new genesis: ', genesisConfig.genesis_transaction);
              });
      }
  })
  .then(() => setTimeout(() => wallet.syncAddresses(), 2000));
