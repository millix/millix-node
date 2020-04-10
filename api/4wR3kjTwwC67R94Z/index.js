import database from '../../database/database';
import wallet from '../../core/wallet/wallet';
import network from '../../net/network';
import peer from '../../net/peer';


// api maintain_database
class _4wR3kjTwwC67R94Z {
    constructor() {
        this.endpoint = '4wR3kjTwwC67R94Z';
    }

    register(app, apiURL) {
        app.put(apiURL + this.endpoint, (req, res) => {
            wallet.stopTasks();
            network.stopTasks();
            peer.stopTasks();
            database.runVacuum()
                    .then(() => database.runWallCheckpoint())
                    .then(() => {
                        wallet.initialize(true)
                              .then(() => network.initialize())
                              .then(() => peer.initialize())
                              .then(() => {
                                  res.send({error: false});
                              });
                    })
                    .catch(() => res.send({error: true}));
        });
    }
};

export default new _4wR3kjTwwC67R94Z();
