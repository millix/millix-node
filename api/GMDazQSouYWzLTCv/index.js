import logManager from '../../core/log-manager';
import Endpoint from '../endpoint';


// api get_mnemonic
class _GMDazQSouYWzLTCv extends Endpoint {
    constructor() {
        super('GMDazQSouYWzLTCv');
    }

    handler(app, req, res) {
        res.send({log: logManager.logsCache});
    }
}


export default new _GMDazQSouYWzLTCv();
