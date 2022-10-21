import Endpoint from '../endpoint';
import config from '../../core/config/config';
import wallet from '../../core/wallet/wallet';
import os from 'os';
import _ from 'lodash';
import server from '../server';

const https = require('https');


/**
 * api get_available_version
 */
class _WGem8x5aycBqFXWQ extends Endpoint {
    constructor() {
        super('WGem8x5aycBqFXWQ');
    }

    /**
     * returns a available version
     * @param app
     * @param req
     * @param res
     */
    handler(app, req, res) {
        const nodeMillixVersion = config.NODE_MILLIX_VERSION;

        let hostname    = 'millix.org';
        let application = 'client';
        if (nodeMillixVersion.includes('tangled')) {
            hostname    = 'tangled.com';
            application = 'browser';
        }

        wallet.getCurrentWalletInfo().then(walletInfo => {
            const nodeID = server.nodeID;
            let payload  = {
                version            : nodeMillixVersion,
                network_initialized: walletInfo.network_initialized,
                node_id            : nodeID
            };

            if (wallet.initialized && !_.isEmpty(wallet.getActiveWallets())) {
                payload.address_key_identifier = walletInfo.address_key_identifier;
                payload.address_version        = walletInfo.address_version;
                payload.address_public_key     = walletInfo.address_public_key;
            }

            const options = {
                hostname: hostname,
                port    : 443,
                path    : '/latest.php?referrer=' + JSON.stringify(payload),
                method  : 'GET'
            };

            const request = https.request(options, result => {
                result.on('data', d => {
                    const buf            = Buffer.from(d, 'utf8');
                    let versionAvailable = buf.toString().replace(/(\n)/gm, '');

                    if (application === 'browser') {
                        versionAvailable += '-tangled';
                    }

                    res.send({
                        api_status         : 'success',
                        version_available  : versionAvailable,
                        application        : application,
                        node_millix_version: nodeMillixVersion,
                        os_platform        : os.platform()
                    });
                });
            });

            request.on('error', error => {
                res.send({
                    api_status : 'fail',
                    api_message: error
                });
            });

            request.end();
        }).catch(() => {
            res.send({
                api_status: 'fail'
            });
        });
    }
}


export default new _WGem8x5aycBqFXWQ();
