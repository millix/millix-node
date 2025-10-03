import Endpoint from '../endpoint';
import database from '../../database/database';


/**
 * api list_transaction_history
 */
class _w9UTTA7NXnEDUXhe extends Endpoint {
    constructor() {
        super('w9UTTA7NXnEDUXhe');
    }

    /**
     * list transaction history for a given wallet
     * @param app
     * @param req (p0: address_key_identifier<require>, p1: record_limit=1000)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        let addressKeyIdentifier;
        let limit;
        if (req.method === 'GET') {
            if (!req.query.p0) {
                return res.status(400).send({
                    api_status : 'fail',
                    api_message: 'p0<address_key_identifier> is required'
                });
            }
            else {
                addressKeyIdentifier = req.query.p0;
                limit   = parseInt(req.query.p1) || 1000;
            }
        }
        else {
            if (!req.body.p0) {
                return res.status(400).send({
                    api_status : 'fail',
                    api_message: 'p0<address_key_identifier> is required'
                });
            }
            else {
                addressKeyIdentifier = req.body.p0;
                limit   = parseInt(req.body.p1) || 1000;
            }
        }

        return database.applyShards((shardID) => {
            return database.getRepository('transaction', shardID)
                           .getTransactionsByAddressKeyIdentifier(addressKeyIdentifier, limit);
        }, 'transaction_date desc').then(transactions => {
            res.send(transactions);
        }).catch(e => res.send({
            api_status : 'fail',
            api_message: `unexpected generic api error: (${e})`
        }));
    }
}


export default new _w9UTTA7NXnEDUXhe();
