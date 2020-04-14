import wallet from '../../core/wallet/wallet';


// api new_transaction
class _VnJIBrrM0KY3uQ9X {
    constructor() {
        this.endpoint = 'VnJIBrrM0KY3uQ9X';
    }

    register(app, apiURL) {
        app.post(apiURL + this.endpoint, (req, res) => {
            let data = req.body;
            wallet.addTransaction(data.address, data.output_list)
                  .then(() => res.send({success: true}))
                  .catch(() => res.send({success: false}));
        });
    }
};

export default new _VnJIBrrM0KY3uQ9X();
