import Endpoint from '../endpoint';
import database from '../../database/database';


/**
 * api list_transaction
 */
class _l4kaEhMnhjB5yseq extends Endpoint {
    constructor() {
        super('l4kaEhMnhjB5yseq');
    }

    /**
     *
     * @param app
     * @param req (p0: date_begin, p1: date_end, p2: node_id_origin, p3:
     *     is_stable, p4: is_parent, p5: is_timeout, p6: create_date_begin, p7:
     *     create_date_end, p8: status, p9: order_by="create_date desc", p10:
     *     record_limit=1000, p11: shard_id)
     * @param res
     */
    handler(app, req, res) {
        const orderBy = req.query.p9 || 'create_date desc';
        const limit   = parseInt(req.query.p10) || 1000;
        const shardID = req.query.p11 || undefined;

        database.applyShards((dbShardID) => {
            const transactionRepository = database.getRepository('transaction', dbShardID);
            if (!transactionRepository) {
                return Promise.resolve([]);
            }
            return transactionRepository.listTransactions({
                transaction_date_begin: req.query.p0,
                transaction_date_end  : req.query.p1,
                node_id_origin        : req.query.p2,
                is_stable             : req.query.p3,
                is_parent             : req.query.p4,
                is_timeout            : req.query.p5,
                create_date_begin     : req.query.p6,
                create_date_end       : req.query.p7,
                status                : req.query.p8,
                shard_id              : shardID
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


export default new _l4kaEhMnhjB5yseq();
