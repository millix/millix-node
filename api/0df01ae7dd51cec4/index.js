import database from '../../database/database';
import Endpoint from '../endpoint';
import mutex from "../../core/mutex";


/**
 * api list_node
 */
class _0df01ae7dd51cec4 extends Endpoint {
    constructor() {
        super('0df01ae7dd51cec4');
    }

    /**
     * returns a list of peer nodes known by the host.  it returns the newest
     * records by default
     * @param app
     * @param res
     */
    handler(app, req, res) {
        console.log(req);
        try {
            let data = mutex.getQueueJobs()
            res.send({
                api_status : 'success',
                api_message: data
            });
        } catch (e) {
            res.send({
                api_status: 'fail',
                api_message: `unexpected generic api error: (${e})`
            });
        }
    }
}


export default new _0df01ae7dd51cec4();
