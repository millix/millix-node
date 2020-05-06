import database from '../../database/database';
import Endpoint from '../endpoint';


// api get_balance
class _zLsiAkocn90e3K6R extends Endpoint {
    constructor() {
        super('zLsiAkocn90e3K6R');
    }

    handler(app, req, res) {
        const transactionRepository = database.getRepository('transaction');
        const stable            = !(req.query.p1 === 'pending');
        transactionRepository.getAddressBalance(req.query.p0, stable)
                         .then(balance => res.send({
                             balance,
                             stable
                         }));
    }
}


export default new _zLsiAkocn90e3K6R();
