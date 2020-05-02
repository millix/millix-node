import logManager from '../../core/log-manager';
import Endpoint from '../endpoint';
import _ from 'lodash';


// api get_mnemonic
class _GMDazQSouYWzLTCv extends Endpoint {
    constructor() {
        super('GMDazQSouYWzLTCv');
    }

    handler(app, req, res) {
        const limit = req.query.p0 || 1000;
        let log     = logManager.log.slice(0, limit);
        _.each(log, entry => entry.content = JSON.parse(entry.content));
        res.send({log});
    }
}


export default new _GMDazQSouYWzLTCv();
