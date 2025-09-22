import Endpoint from '../endpoint';
import database from '../../database/database';


/**
 * api list_transaction_having_key_identifier
 */
class _MC5Crzt68CmDc5cY extends Endpoint {
    constructor() {
        super('MC5Crzt68CmDc5cY');
    }

    /**
     *
     * @param app
     * @param req (p0: date_begin, p1: date_end, p2: node_id_origin, p3:
     *     is_stable, p4: is_parent, p5: is_timeout, p6: create_date_begin, p7:
     *     create_date_end, p8: status, p9: key_identifier,
     *     p10: order_by="create_date desc", p11: record_limit=1000, p12:
     *     shard_id)
     * @param res
     */
    handler(app, req, res) {
        const orderBy       = req.query.p10 || 'create_date desc';
        const limit         = parseInt(req.query.p11) || 1000;
        const shardID       = req.query.p12 || undefined;
        const keyIdentifier = req.query.p9;

        if (!keyIdentifier) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p9<keyIdentifier> is required'
            });
        }

        database.applyShards((dbShardID) => {
            const transactionRepository = database.getRepository('transaction', dbShardID);
            if (!transactionRepository) {
                return Promise.resolve([]);
            }
            return transactionRepository.listTransactionsWithKeyIdentifier(keyIdentifier, {
                transaction_date_begin           : req.query.p0,
                transaction_date_end             : req.query.p1,
                node_id_origin                   : req.query.p2,
                '`transaction`.is_stable'        : req.query.p3,
                is_parent                        : req.query.p4,
                is_timeout                       : req.query.p5,
                '`transaction`.create_date_begin': req.query.p6,
                '`transaction`.create_date_end'  : req.query.p7,
                '`transaction`.status'           : req.query.p8,
                '`transaction`.shard_id'         : shardID
            }, orderBy, limit);
        }, orderBy, limit, shardID).then(data => {
            data.forEach(row => row['transaction_date'] = Math.floor(row.transaction_date.getTime() / 1000));
            res.send(data);
        }).catch(e => res.send({
            api_status : 'fail',
            api_message: `unexpected generic api error: (${e})`
        }));
    }
}


export default new _MC5Crzt68CmDc5cY();
