import Endpoint from '../endpoint';
import database from '../../database/database';
import transactionDataUtils from '../../core/utils/transaction-data-utils';


/**
 * api list_transaction_output_attribute_received
 */
class _Mu7VpxzfYyQimf3V extends Endpoint {
    constructor() {
        super('Mu7VpxzfYyQimf3V');
        this.normalizationRepository = database.getRepository('normalization');
    }

    /**
     *
     * @param app
     * @param req (p0: date_begin, p1: date_end, p2: node_id_origin, p3:
     *     is_stable, p4: is_parent, p5: is_timeout, p6: create_date_begin, p7:
     *     create_date_end, p8: status, p9: version,
     *     p10:address_key_identifier, p11: attribute_type_id, p12: data_type,
     *     p13:order_by="create_date desc", p14: record_limit=1000, p15:
     *     shard_id)
     * @param res
     */
    handler(app, req, res) {
        const orderBy         = req.query.p13 || '`transaction`.create_date desc';
        const limit           = parseInt(req.query.p14) || 1000;
        const shardID         = req.query.p15 || undefined;
        const dataType        = req.query.p12 || undefined;
        const attributeTypeId = req.query.p11 || undefined;

        database.applyShards((dbShardID) => {
            const transactionRepository = database.getRepository('transaction', dbShardID);
            if (!transactionRepository) {
                return Promise.resolve([]);
            }
            return transactionRepository.listTransactionOutput({
                '`transaction`.transaction_date_begin': req.query.p0,
                '`transaction`.transaction_date_end'  : req.query.p1,
                '`transaction`.node_id_origin'        : req.query.p2,
                '`transaction`.is_stable'             : req.query.p3,
                '`transaction`.is_parent'             : req.query.p4,
                '`transaction`.is_timeout'            : req.query.p5,
                '`transaction`.create_date_begin'     : req.query.p6,
                '`transaction`.create_date_end'       : req.query.p7,
                '`transaction`.status'                : req.query.p8,
                '`transaction`.version'               : req.query.p9,
                'address_key_identifier'              : req.query.p10,
                'is_spent'                            : dataType === 'tangled_nft' ? 0 : undefined,
                'output_position!'                    : -1, //discard fee output
                '`transaction`.shard_id'              : shardID
            }, orderBy, limit);
        }, orderBy, limit, shardID)
                .then(outputList => {
                    transactionDataUtils.processOutputList(outputList, attributeTypeId, orderBy, limit, shardID, dataType).then(data => {
                        res.send(data);
                    });
                })
                .catch(e => res.send({
                    api_status : 'fail',
                    api_message: `unexpected generic api error: (${e})`
                }));
    }
}


export default new _Mu7VpxzfYyQimf3V();
