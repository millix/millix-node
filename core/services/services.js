import wallet, {WALLET_MODE} from '../wallet/wallet';
import network from '../../net/network';
import server from '../../api/server';
import peer from '../../net/peer';
import peerRotation from '../../net/peer-rotation';
import jobEngine from '../../job/job-engine';
import console from '../console';
import logManager from '../log-manager';
import database from '../../database/database';
import cache from '../cache';


class Service {
    constructor() {
        this.mode        = WALLET_MODE.CONSOLE;
        this.initialized = false;
    }

    initialize(options = {}) {
        let {
                mode,
                initialize_wallet_event: initializeWalletEvent,
                auto_create_wallet     : createWalletIfNotExists
            } = options;
        if (this.initialized) {
            return Promise.resolve();
        }
        this.initialized = true;
        if (mode) {
            this.mode = mode;
        }

        if (createWalletIfNotExists === undefined) {
            createWalletIfNotExists = true;
        }
        return logManager.initialize()
                         .then(() => server.initialize())
                         .then(() => wallet.setMode(this.mode).initialize(initializeWalletEvent, createWalletIfNotExists))
                         .then(() => cache.initialize())
                         .then(() => network.initialize())
                         .then(() => peer.initialize())
                         .then(() => peerRotation.initialize())
                         .then(() => jobEngine.initialize())
                         .then(() => wallet._doUpdateNodeAttribute())
                         .then(() => database.checkup())
                         .catch(e => {
                             console.log(`[services] ${e.message}`);
                             this.initialized = false;
                             if (e.cause === 'wallet_not_found') {
                                 return;
                             }
                             return this.initialize(options);
                         });
    }

    stop() {
        if (!this.initialized) {
            return;
        }
        this.initialized = false;
        wallet.stop();
        cache.stop();
        network.stop();
        peer.stop();
        peerRotation.stop();
        logManager.stop();
        jobEngine.stop();
    }
}


export default new Service();
