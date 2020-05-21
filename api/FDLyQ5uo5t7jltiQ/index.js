import database from '../../database/database';
import Endpoint from '../endpoint';


/**
 * api list_transaction_output
 */
class _FDLyQ5uo5t7jltiQ extends Endpoint {
    constructor() {
        super('FDLyQ5uo5t7jltiQ');
    }

    /**
     * returns records from table transaction_output that match the provided
     * parameters.  it returns the newest records by default
     * @param app
     * @param req (p0: transaction_id, p1: date_begin, p2: date_end, p3:
     *     address_key_identifier, p4: is_double_spend, p5:
     *     double_spend_date_begin, p6: double_spend_date_end, p7: is_stable,
     *     p8: stable_date_begin, p9: stable_date_end, p10: is_spent, p11:
     *     spent_date_begin, p12: spent_date_end, p13: order_by="create_date
     *     desc", p14: record_limit=1000, p15: shard_id)
     * @param res
     */
    handler(app, req, res) {
        const orderBy = req.query.p13 || 'create_date desc';
        const limit   = parseInt(req.query.p14) || 1000;
        const shardID = req.query.p15;
        database.applyShards((dbShardID) => {
            const transactionRepository = database.getRepository('transaction', dbShardID);
            if (!transactionRepository) {
                return Promise.resolve([]);
            }
            return transactionRepository.listTransactionOutput({
                'transaction_output.transaction_id'   : req.query.p0,
                transaction_date_begin                : req.query.p1,
                transaction_date_end                  : req.query.p2,
                address_key_identifier                : req.query.p3,
                is_double_spend                       : req.query.p4,
                double_spend_date_begin               : req.query.p5,
                double_spend_date_end                 : req.query.p6,
                'transaction_output.is_stable'        : req.query.p7,
                'transaction_output.stable_date_begin': req.query.p8,
                'transaction_output.stable_date_end'  : req.query.p9,
                is_spent                              : req.query.p10,
                spent_date_begin                      : req.query.p11,
                spent_date_end                        : req.query.p12
            }, orderBy, limit, shardID);
        }, orderBy, limit, shardID).then(data => res.send(data));
    }
}


export default new _FDLyQ5uo5t7jltiQ();
