import wallet from '../../core/wallet/wallet';


// api transaction_new
class _VnJIBrrM0KY3uQ9X {
    constructor() {
        this.endpoint = 'VnJIBrrM0KY3uQ9X';
    }

    register(app, apiURL) {
        app.post(apiURL + this.endpoint, (req, res) => {
            let data = req.body;
            wallet.addTransaction(data.address, data.ouput_list)
                  .then(() => res.send({success: true}))
                  .catch(() => res.send({success: false}));
        });
    }
};

export default new _VnJIBrrM0KY3uQ9X();
