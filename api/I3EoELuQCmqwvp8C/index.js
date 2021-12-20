import database from '../../database/database';
import Endpoint from '../endpoint';


/**
 * api list_transaction_input
 */
class _I3EoELuQCmqwvp8C extends Endpoint {
    constructor() {
        super('I3EoELuQCmqwvp8C');
    }

    /**
     * returns records from table transaction_input that match the provided
     * parameters.  it returns the newest records by default
     * @param app
     * @param req (p0: transaction_id, p1: date_begin, p2: date_end, p3:
     *     address_key_identifier, p4: is_double_spend, p5:
     *     double_spend_date_begin, p6: double_spend_date_end, p7:
     *     output_transaction_id, p8: output_position, p9:
     *     order_by="create_date desc", p10: record_limit=1000, p11: shard_id
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
            return transactionRepository.listTransactionInput({
                'transaction_input.transaction_id': req.query.p0,
                transaction_date_begin            : req.query.p1,
                transaction_date_end              : req.query.p2,
                address_key_identifier            : req.query.p3,
                is_double_spend                   : req.query.p4,
                double_spend_date_begin           : req.query.p5,
                double_spend_date_end             : req.query.p6,
                output_transaction_id             : req.query.p7,
                output_position                   : req.query.p8,
                'transaction_input.shard_id'      : shardID
            }, orderBy, limit);
        }, orderBy, limit, shardID)
                .then(data => res.send(data))
                .catch(e => res.send({
                    api_status : 'fail',
                    api_message: `unexpected generic api error: (${e})`
                }));
    }
}


export default new _I3EoELuQCmqwvp8C();
