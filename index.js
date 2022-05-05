import console from './core/console';
import logger from './core/logger';
import db from './database/database';
import eventBus from './core/event-bus';
import config from './core/config/config';
import configLoader from './core/config/config-loader';
import genesisConfig from './core/genesis/genesis-config';
import request from 'request';
import services from './core/services/services';
import logManager from './core/log-manager';

const argv = require('yargs')
    .options({
        'initial-peers': {
            demandOption: false,
            array       : true
        },
        'nat-pmp'      : {
            type   : 'boolean',
            default: true
        }
    }).argv;

if (argv.initialPeers) {
    config.NODE_INITIAL_LIST = argv.initialPeers.map(e => {
        const part = e.split(':');
        return {
            host          : part[0],
            port_protocol : parseInt(part[1]),
            port_api      : parseInt(part[2]),
            port_discovery: parseInt(part[3])
        };
    });
}

if (argv.bind) {
    config.NODE_BIND_IP = argv.bind;
}

if (argv.port) {
    config.NODE_PORT = argv.port;
}

if (argv.portDiscovery) {
    config.NODE_PORT_DISCOVERY = argv.portDiscovery;
}

if (argv.apiPort) {
    config.NODE_PORT_API = argv.apiPort;
}

if (argv.storageProviderPort) {
    config.NODE_PORT_STORAGE_PROVIDER = argv.storageProviderPort;
}

if (argv.storageReceiverPort) {
    config.NODE_PORT_STORAGE_RECEIVER = argv.storageReceiverPort;
}

if (argv.host) {
    config.NODE_HOST = argv.host;
}

if (argv.hostForce) {
    config.NODE_HOST_FORCE = argv.hostForce;
}

if (argv.testHost) {
    config.NODE_TEST_HOST = argv.testHost;
}

if (argv.testPort) {
    config.NODE_TEST_PORT = argv.testPort;
}

if (argv.dataFolder) {
    config.STORAGE_CONNECTION.FOLDER             = argv.dataFolder + '/storage/';
    config.STORAGE_CONNECTION.PENDING_TO_SEND    = argv.dataFolder + '/storage/sending.log';
    config.STORAGE_CONNECTION.PENDING_TO_RECEIVE = argv.dataFolder + '/storage/receiving.log';
    config.WALLET_KEY_PATH                       = argv.dataFolder + 'millix_private_key.json';
    config.NODE_KEY_PATH                         = argv.dataFolder + 'node.json';
    config.NODE_CERTIFICATE_KEY_PATH             = argv.dataFolder + 'node_certificate_key.pem';
    config.NODE_CERTIFICATE_PATH                 = argv.dataFolder + 'node_certificate.pem';
    config.JOB_CONFIG_PATH                       = argv.dataFolder + 'job.json';
    config.DATABASE_CONNECTION.FOLDER            = argv.dataFolder;
}

if (argv.debug === 'true') {
    config.MODE_DEBUG = true;
}

if (!argv.natPmp) {
    config.NODE_NAT_PMP = false;
}

process.title = 'millix-node';

let shutdown = false;
process.on('SIGINT', async function() {
    if (!shutdown) {
        shutdown = true;
        console.log('\n[main] gracefully shutting down from SIGINT (Crtl-C)');
        console.log('[main] closing all db connections');
        await db.close();
        console.log('[main] all db connections closed');
        process.exit(0);
    }
});
logger.initialize().then(() => {
    console.log('starting millix-core');
    db.initialize()
      .then(() => configLoader.cleanConfigsFromDatabase())
      .then(() => configLoader.load(false))
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
      });
});
