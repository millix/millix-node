import wallet, {WALLET_MODE} from '../wallet/wallet';
import network from '../../net/network';
import server from '../../api/server';
import peer from '../../net/peer';
import jobEngine from '../../job/job-engine';
import console from '../console';
import logManager from '../log-manager';
import database from '../../database/database';
import genesisConfig from '../../core/genesis/genesis-config';
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
                         .then(() => network.initialize())
                         .then(() => peer.initialize())
                         .then(() => server.initialize())
                         .then(() => jobEngine.initialize())
                         .then(() => {
                             return new Promise(resolve => {
                                 const nodeRepository = database.getRepository('node');
                                 nodeRepository.addNodeAttribute(network.nodeID, 'shard_protocol', JSON.stringify([
                                     {
                                         'shard_id'            : genesisConfig.genesis_shard_id,
                                         'transaction_count'   : 0,
                                         'update_date'         : Math.floor(ntp.now().getTime() / 1000),
                                         'is_assigned'         : true,
                                         'fee_ask_request_byte': 20
                                     }
                                 ]))
                                               .then(() => resolve())
                                               .catch(() => resolve());
                             });
                         })
                         .then(() => wallet.setMode(this.mode).initialize(initializeWalletEvent))
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
        logManager.stop();
        jobEngine.stop();
    }
}


export default new Service();
