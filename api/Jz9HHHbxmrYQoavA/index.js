import Endpoint from '../endpoint';
import vpnExit from '../../net/vpn/vpn-exit';


/**
 * api list_vpn_exit_session
 */
class _Jz9HHHbxmrYQoavA extends Endpoint {
    constructor() {
        super('Jz9HHHbxmrYQoavA');
    }

    /**
     * returns the sessions this exit node carries: the bytes sent, the
     * latest receipt from each pass and the sites visited
     * @param app
     * @param req
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (!vpnExit.isRunning()) {
            return res.send({
                api_status : 'fail',
                api_message: 'vpn_exit_not_running'
            });
        }

        res.send({
            api_status  : 'success',
            session_list: vpnExit.getSessionList()
        });
    }
}


export default new _Jz9HHHbxmrYQoavA();
