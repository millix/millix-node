import wallet from '../../core/wallet/wallet';


// api reset_validation
class _Fv9lheUpVYq5caRe {
    constructor() {
        this.endpoint = 'Fv9lheUpVYq5caRe';
    }

    register(app, apiURL) {
        app.get(apiURL + this.endpoint, (req, res) => {
            wallet.getConsensus().resetTransactionValidationRejected();
            res.send({error: false});
        });
    }
};

export default new _Fv9lheUpVYq5caRe();
