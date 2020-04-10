import database from '../../database/database';
import wallet from '../../core/wallet/wallet';


// api transaction_list
class _l4kaEhMnhjB5yseq {
    constructor() {
        this.endpoint = 'l4kaEhMnhjB5yseq';
    }

    register(app, apiURL) {
        app.get(apiURL + this.endpoint, (_, res) => {
            wallet.getAllTransactions()
                  .then(transactions => res.send(transactions));
        });
    }
};

export default new _l4kaEhMnhjB5yseq();
