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
import fs from 'fs';
import path from 'path';
import os from 'os';

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

let pidFile      = argv.pidFile;
const dataFolder = argv.dataFolder ?
                   path.isAbsolute(argv.dataFolder) ? argv.dataFolder : path.join(os.homedir(), argv.dataFolder)
                                   : path.join(os.homedir(), config.DATABASE_CONNECTION.FOLDER);
if (dataFolder) {
    config.STORAGE_CONNECTION.FOLDER             = path.join(dataFolder, '/storage/');
    config.STORAGE_CONNECTION.PENDING_TO_SEND    = path.join(dataFolder, '/storage/sending.log');
    config.STORAGE_CONNECTION.PENDING_TO_RECEIVE = path.join(dataFolder, '/storage/receiving.log');
    config.WALLET_KEY_PATH                       = path.join(dataFolder, 'millix_private_key.json');
    config.NODE_KEY_PATH                         = path.join(dataFolder, 'node.json');
    config.NODE_CERTIFICATE_KEY_PATH             = path.join(dataFolder, 'node_certificate_key.pem');
    config.NODE_CERTIFICATE_PATH                 = path.join(dataFolder, 'node_certificate.pem');
    config.JOB_CONFIG_PATH                       = path.join(dataFolder, 'job.json');
    config.DATABASE_CONNECTION.FOLDER            = dataFolder;
}

if (pidFile && !path.isAbsolute(pidFile)) {
    pidFile = dataFolder ? path.join(dataFolder, pidFile) : path.join(os.homedir(), pidFile);
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

        if (pidFile && fs.existsSync(pidFile)) {
            fs.unlinkSync(pidFile);
        }

        process.exit(0);
    }
});

const checkPIDFile = () => {
    if (!pidFile) {
        console.log('pid file not in use');
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        if (!fs.existsSync(pidFile)) {
            fs.writeFile(pidFile, process.pid, () => {
                resolve();
            });
            return;
        }

        fs.readFile(pidFile, 'utf-8', (err, data) => {
            let pid           = parseInt(data);
            let processKilled = false;
            if (Number.isInteger(pid)) {
                try {
                    process.kill(pid);
                }
                catch (ignore) {
                }
                processKilled = true;
                console.log('zombie process killed, pid:', pid);
            }
            fs.writeFile(pidFile, process.pid, () => {
                setTimeout(() => resolve(), processKilled ? 1000 : 0);
            });
        });
    });
};

logger.initialize().then(() => {
    console.log('starting millix-core');
    checkPIDFile()
        .then(() => db.initialize())
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
