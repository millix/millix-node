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
        mutex.deleteBacklogData();

        res.send({
            api_status: 'success'
        });
    }
}


export default new _epOW5kdvb12QdgsV();
