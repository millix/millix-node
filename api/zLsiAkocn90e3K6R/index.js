import database from '../../database/database';


// api get_balance
class _zLsiAkocn90e3K6R {
    constructor() {
        this.endpoint = 'zLsiAkocn90e3K6R';
    }

    register(app, apiURL) {
        const addressRepository = database.getRepository('address');
        app.get(apiURL + this.endpoint, (req, res) => {
            const stable = !(req.query.p1 === 'pending');
            addressRepository.getAddressBalance(req.query.p0, stable)
                             .then(balance => res.send({
                                 balance,
                                 stable
                             }));
        });
    }
};

export default new _zLsiAkocn90e3K6R();
