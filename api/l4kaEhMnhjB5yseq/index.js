import wallet from '../../core/wallet/wallet';
import Endpoint from '../endpoint';


// api list_transaction
class _l4kaEhMnhjB5yseq extends Endpoint {
    constructor() {
        super('l4kaEhMnhjB5yseq');
    }

    handler(app, req, res) {
        wallet.getAllTransactions()
              .then(transactions => res.send(transactions));
    }
}


export default new _l4kaEhMnhjB5yseq();
