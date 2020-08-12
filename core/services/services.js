import wallet, {WALLET_MODE} from '../wallet/wallet';
import network from '../../net/network';
import server from '../../api/server';
import peer from '../../net/peer';
import peerRotation from '../../net/peer-rotation';
import jobEngine from '../../job/job-engine';
import console from '../console';
import logManager from '../log-manager';
import database from '../../database/database';
import _ from 'lodash';
import ntp from '../ntp';


class Service {
    constructor() {
        this.mode        = WALLET_MODE.CONSOLE;
        this.initialized = false;
    }

    initialize(options = {}) {
        const {mode, initialize_wallet_event: initializeWalletEvent} = options;
        if (this.initialized) {
            return Promise.resolve();
        }
        this.initialized = true;
        if (mode) {
            this.mode = mode;
        }
        return logManager.initialize()
                         .then(() => {
                             console.log('[services] Checking for expired transactions on startup');
                             return wallet._doTransactionOutputExpiration();
                         })
                         .then(() => server.initialize())
                         .then(() => wallet.setMode(this.mode).initialize(initializeWalletEvent))
                         .then(() => network.initialize())
                         .then(() => peer.initialize())
                         .then(() => peerRotation.initialize())
                         .then(() => jobEngine.initialize())
                         .then(() => wallet._doUpdateNodeAttribute())
                         .catch(e => {
                             console.log(e);
                         });
    }

    stop() {
        if (!this.initialized) {
            return;
        }
        this.initialized = false;
        wallet.stop();
        network.stop();
        peer.stop();
        peerRotation.stop();
        logManager.stop();
        jobEngine.stop();
    }
}


export default new Service();
