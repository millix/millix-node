import database from '../../database/database';
import wallet from '../../core/wallet/wallet';
import network from '../../net/network';
import peer from '../../net/peer';
import Endpoint from '../endpoint';


// api maintain_database
class _4wR3kjTwwC67R94Z extends Endpoint {
    constructor() {
        super('4wR3kjTwwC67R94Z');
    }

    handler(app, req, res) {
        wallet.stop();
        network.stop();
        peer.stop();
        database.runVacuum()
                .then(() => database.runWallCheckpoint())
                .then(() => {
                    wallet.initialize(true)
                          .then(() => network.initialize())
                          .then(() => peer.initialize())
                          .then(() => {
                              res.send({success: true});
                          });
                })
                .catch(() => res.send({success: false}));
    }
}


export default new _4wR3kjTwwC67R94Z();
