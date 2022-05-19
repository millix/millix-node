import Endpoint from '../endpoint';
import mutex from '../../core/mutex';


/**
 * api reset_backlog
 */
class _epOW5kdvb12QdgsV extends Endpoint {
    constructor() {
        super('epOW5kdvb12QdgsV');
    }

    /**
     * reset backlog
     * @param app
     * @param req
     * @param res
     */
    handler(app, req, res) {
        mutex.resetBacklog();

        res.send({
            api_status: 'success'
        });
    }
}


export default new _epOW5kdvb12QdgsV();
