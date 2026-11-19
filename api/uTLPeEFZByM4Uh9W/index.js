import Endpoint from '../endpoint';
import vpnClient from '../../net/vpn/vpn-client';


/**
 * api list_vpn_session
 */
class _uTLPeEFZByM4Uh9W extends Endpoint {
    constructor() {
        super('uTLPeEFZByM4Uh9W');
    }

    /**
     * returns this node's vpn sessions as a user, with the bytes received and
     * the receipts signed and sent to the exit node
     * @param app
     * @param req (p0: session_id)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const sessionID = req.query.p0;
        if (sessionID) {
            const session = vpnClient.getSession(sessionID);
            if (!session) {
                return res.send({
                    api_status : 'fail',
                    api_message: 'session_not_found'
                });
            }
            return res.send({
                api_status  : 'success',
                session_list: [session]
            });
        }

        res.send({
            api_status  : 'success',
            session_list: vpnClient.listSession()
        });
    }
}


export default new _uTLPeEFZByM4Uh9W();
