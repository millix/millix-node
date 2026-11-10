import Endpoint from '../endpoint';
import {forwardServer} from '../../net/vpn/forward';
import vpnExit from '../../net/vpn/vpn-exit';
import config from '../../core/config/config';


/**
 * api list_cloud_forward_host
 */
class _XplGSKUo0zHeCIxp extends Endpoint {
    constructor() {
        super('XplGSKUo0zHeCIxp');
    }

    /**
     * returns how this node's exit node is reached (directly or through a
     * forwarding node) and, on a forwarding node, the hosts registered with
     * it and the bytes relayed for each
     * @param app
     * @param req
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        res.send({
            api_status      : 'success',
            vpn_exit_forward: config.VPN_EXIT_FORWARD,
            forward_endpoint: vpnExit.getForwardEndpoint(),
            forward_running : forwardServer.isRunning(),
            host_list       : forwardServer.getHostList()
        });
    }
}


export default new _XplGSKUo0zHeCIxp();
