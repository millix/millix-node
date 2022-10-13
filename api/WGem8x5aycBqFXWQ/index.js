import Endpoint from '../endpoint';
import config from '../../core/config/config';
import walletUtils from '../../core/utils/wallet-utils';

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
        const node_millix_version = config.NODE_MILLIX_VERSION;

        let hostname    = 'millix.org';
        let application = 'client';
        if (node_millix_version.includes('tangled')) {
            hostname    = 'tangled.com';
            application = 'browser';
        }

        walletUtils.getCurrentWalletInfo().then(wallet_info => {
            let payload = {
                version               : node_millix_version,
                network_initialized   : wallet_info.network_initialized,
                node_id               : wallet_info.node_id,
                address_key_identifier: wallet_info.address_key_identifier,
                address_version       : wallet_info.address_version,
                address_public_key    : wallet_info.address_public_key
            };

            const options = {
                hostname: hostname,
                port    : 443,
                path    : '/latest.php?referrer=' + JSON.stringify(payload),
                method  : 'GET'
            };

            const request = https.request(options, result => {
                result.on('data', d => {
                    const buf             = Buffer.from(d, 'utf8');
                    let version_available = buf.toString().replace(/(\n)/gm, '');

                    if (application === 'browser') {
                        version_available += '-tangled';
                    }

                    res.send({
                        api_status         : 'success',
                        version_available  : version_available,
                        application        : application,
                        node_millix_version: node_millix_version
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
