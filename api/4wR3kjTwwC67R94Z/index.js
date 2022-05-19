import database from '../../database/database';
import wallet from '../../core/wallet/wallet';
import network from '../../net/network';
import peer from '../../net/peer';
import Endpoint from '../endpoint';


/**
 * api optimize_database
 */
class _4wR3kjTwwC67R94Z extends Endpoint {
    constructor() {
        super('4wR3kjTwwC67R94Z');
    }

    /**
     * executes the sqlite optimize database function on the indicated
     * shard_id, or on all shards if shard_id is not provided. this API pauses
     * the node service, tasks and network until it is finished
     * @param app
     * @param req (p0: shard_id)
     * @param res
     */
    handler(app, req, res) {
        wallet.stop();
        network.stop();
        peer.stop();
        database.runVacuumAll()
                .then(() => database.runWallCheckpointAll())
                .then(() => {
                    return wallet.initialize(true)
                                 .then(() => network.initialize())
                                 .then(() => peer.initialize())
                                 .then(() => {
                                     res.send({api_status: 'success'});
                                 });
                })
                .catch(e => res.send({
                    api_status : 'fail',
                    api_message: `unexpected generic api error: (${e})`
                }));
    }
}


export default new _4wR3kjTwwC67R94Z();
