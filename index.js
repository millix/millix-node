import console from './core/console';
import db from './database/database';
import wallet from './core/wallet/wallet';
import config from './core/config/config';
import genesisConfig from './core/genesis/genesis-config';
import request from 'request';
import services from './core/serices/services';

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

if (argv.folder) {
    config.KEY_PATH                   = argv.folder + 'millix_private_key.json';
    config.NODE_KEY_PATH              = argv.folder + 'node.json';
    config.JOB_CONFIG_PATH            = argv.folder + 'job.json';
    config.DATABASE_CONNECTION.FOLDER = argv.folder;
}

let initGenesis = false;
if (argv.genesis) {
    initGenesis = argv.genesis;
}

if (argv.debug) {
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
      if (config.MODE_TEST) {
          request.post('http://' + config.NODE_TEST_HOST + ':' + config.NODE_TEST_PORT + '/register',
              {
                  json: true,
                  body: {host: config.NODE_HOST + ':' + config.NODE_PORT_API}
              },
              (err, res, data) => {
                  genesisConfig.genesis_transaction = data.genesis;
                  console.log('registered new genesis: ', genesisConfig.genesis_transaction);
              });
      }
  })
  .then(() => setTimeout(() => wallet.syncAddresses(), 2000));
