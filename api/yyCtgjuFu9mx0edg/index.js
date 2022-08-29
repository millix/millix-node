import Endpoint from '../endpoint';
import database from '../../database/database';
import transactionDataUtils from '../../core/utils/transaction-data-utils';


/**
 * api get_transaction_output_attribute_received
 */
class _yyCtgjuFu9mx0edg extends Endpoint {
    constructor() {
        super('yyCtgjuFu9mx0edg');
        this.normalizationRepository = database.getRepository('normalization');
    }

    /**
     *
     * @param app
     * @param req (p0: transaction_id<required>, p1: shard_id, p2:
     *     attribute_type_id, p3: data_type)
     * @param res
     */
    handler(app, req, res) {
        const transactionID   = req.query.p0 || undefined;
        const shardID         = req.query.p1 || undefined;
        const dataType        = req.query.p3 || undefined;
        const attributeTypeId = req.query.p2 || undefined;

        const limit = undefined;
        const orderBy = undefined;


        database.applyShards((dbShardID) => {
            const transactionRepository = database.getRepository('transaction', dbShardID);
            if (!transactionRepository) {
                return Promise.resolve([]);
            }

            return transactionRepository.listTransactionOutput({
                'transaction_output.transaction_id'   : transactionID,
                'output_position!'                    : -1, //discard fee output
                '`transaction`.shard_id'              : shardID
            }, orderBy, limit);
        }, orderBy, limit, shardID)
                .then(outputList => {
                    transactionDataUtils.processOutputList(outputList, attributeTypeId, orderBy, limit, shardID, dataType).then(data => {
                        res.send(data.pop());
                    });
                })
                .catch(e => res.send({
                    api_status : 'fail',
                    api_message: `unexpected generic api error: (${e})`
                }));
    }
}


export default new _yyCtgjuFu9mx0edg();
