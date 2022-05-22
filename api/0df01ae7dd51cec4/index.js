import Endpoint from '../endpoint';
import mutex from '../../core/mutex';


/**
 * api get_backlog_list
 */
class _0df01ae7dd51cec4 extends Endpoint {
    constructor() {
        super('0df01ae7dd51cec4');
    }

    /**
     * returns a backlog list.
     * @param app
     * @param req
     * @param res
     */
    handler(app, req, res) {
        mutex.getBacklogList().then(backlogList => {
            res.send({
                api_status  : 'success',
                backlog_list: backlogList
            });
        });
    }
}


export default new _0df01ae7dd51cec4();
