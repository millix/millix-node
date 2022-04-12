import Endpoint from '../endpoint';

const https = require('https')

/**
 * api get_latest_millix_version
 */
class _WGem8x5aycBqFXWQ extends Endpoint {
    constructor() {
        super('WGem8x5aycBqFXWQ');
    }

    /**
     * returns a latest millix version
     * @param app
     * @param req (p0: account<require>)
     * * @param res
     */
    handler(app, req, res) {
        let account;

        if (!req.query.p0) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<account> is required'
            });
        }
        else {
            account = req.query.p0;
        }

        const options = {
            hostname: `${account}.org`,
            port: 443,
            path: '/latest.php',
            method: 'GET'
        }

        const request = https.request(options, result => {
            result.on('data', d => {
                const buf = Buffer.from(d, 'utf8');
                res.send({
                    api_status: 'success',
                    api_message: buf.toString().replace(/(\n)/gm, "")
                })
            })
        })

        request.on('error', error => {
            res.send({
                api_status: 'fail',
                api_message: error
            })
        })

        request.end()
    }
}


export default new _WGem8x5aycBqFXWQ();
