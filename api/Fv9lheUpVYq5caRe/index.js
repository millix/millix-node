import wallet from '../../core/wallet/wallet';
import Endpoint from '../endpoint';


// api reset_validation
class _Fv9lheUpVYq5caRe extends Endpoint {
    constructor() {
        super('Fv9lheUpVYq5caRe');
    }

    handler(app, req, res) {
        wallet.getConsensus().resetTransactionValidationRejected();
        res.send({status: 'success'});
    }
}


export default new _Fv9lheUpVYq5caRe();
