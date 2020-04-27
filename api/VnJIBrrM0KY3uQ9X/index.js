import wallet from '../../core/wallet/wallet';
import Endpoint from '../endpoint';


// api new_transaction
class _VnJIBrrM0KY3uQ9X extends Endpoint{
    constructor() {
        super('VnJIBrrM0KY3uQ9X');
    }

    handler(app, req, res) {
        let data = JSON.parse(req.query.p1);
        wallet.addTransaction(data.address, data.output_list)
              .then(() => res.send({success: true}))
              .catch(() => res.send({success: false}));
    }
};

export default new _VnJIBrrM0KY3uQ9X();
