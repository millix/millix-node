import logManager from '../../core/log-manager';


// api get_mnemonic
class _GMDazQSouYWzLTCv {
    constructor() {
        this.endpoint = 'GMDazQSouYWzLTCv';
    }

    register(app, apiURL) {
        app.get(apiURL + this.endpoint, (req, res) => {
            res.send({log: logManager.logsCache});
        });
    }
}


export default new _GMDazQSouYWzLTCv();
