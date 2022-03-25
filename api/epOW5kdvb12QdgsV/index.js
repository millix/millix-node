import Endpoint from '../endpoint';
import mutex from "../../core/mutex";


/**
 * api delete_backlog_records
 */
class _epOW5kdvb12QdgsV extends Endpoint {
    constructor() {
        super('epOW5kdvb12QdgsV');
    }

    /**
     * delete backlog transaction from mutex queue
     * @param app
     * @param req
     * @param res
     */
    handler(app, req, res) {
        try {
            mutex.deleteBacklogData()
            res.send({
                api_status: 'success',
                api_message: `ok`
            });
        } catch (e) {
            res.send({
                api_status: 'fail',
                api_message: `unexpected generic api error: (${e})`
            });
        }
    }
}


export default new _epOW5kdvb12QdgsV();
