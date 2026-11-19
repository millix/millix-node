import Endpoint from '../endpoint';
import vpnClient from '../../net/vpn/vpn-client';


/**
 * api close_vpn_session
 */
class _0KgPxqibCfmtcKsd extends Endpoint {
    constructor() {
        super('0KgPxqibCfmtcKsd');
    }

    /**
     * sends the last receipt and closes a vpn session opened by this node
     * @param app
     * @param req (p0: session_id<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (!req.query.p0) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<session_id> is required'
            });
        }

        vpnClient.closeSession(req.query.p0)
                 .then(session => res.send({
                     api_status: 'success',
                     session
                 }))
                 .catch(e => res.send({
                     api_status : 'fail',
                     api_message: `${e}`
                 }));
    }
}


export default new _0KgPxqibCfmtcKsd();
