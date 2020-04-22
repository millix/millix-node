import jwt from 'jsonwebtoken';

export default class Endpoint {
    constructor(endpoint) {
        this.endpoint = endpoint;
    }

    handler() {
        throw new Error('You must to implement the method handler!');
    }

    onRequest(app, secure, req, res) {
        if (secure) {
            try {
                const decoded = jwt.verify(req.query.p0, app.secret);
            }
            catch (e) {
                return res.status(400).send('invalid authentication token.');
            }
        }
        this.handler(app, req, res);
    }

    register(app, apiURL, secure) {
        app.post(apiURL + this.endpoint, this.onRequest.bind(this, app, secure));
        app.get(apiURL + this.endpoint, this.onRequest.bind(this, app, secure));
    }
}
