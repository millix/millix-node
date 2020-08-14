import database from '../../database/database';
import Endpoint from '../endpoint';
import async from 'async';
import _ from 'lodash';


/**
 * api get_node_transaction_stat_summary
 */
class _C9rEOewwhQDijCnN extends Endpoint {
    constructor() {
        super('C9rEOewwhQDijCnN');
    }

    /**
     * returns a summary of transaction statistics from the host
     * @param app
     * @param req
     * @param res
     */
    handler(app, req, res) {
        async.mapSeries(
            [
                () => database.applyShards(shardID => {
                    return database.getRepository('transaction', shardID).getFreeTransactionsCount();
                }).then(_.sum),
                () => database.applyShards(shardID => {
                    return database.getRepository('transaction', shardID).getIncludedTransactionsCount();
                }).then(_.sum),
                () => database.applyShards(shardID => {
                    return database.getRepository('transaction', shardID).getInputsCount();
                }).then(_.sum),
                () => database.applyShards(shardID => {
                    return database.getRepository('transaction', shardID).getOutputsCount();
                }).then(_.sum),
                () => database.applyShards(shardID => {
                    return database.getRepository('transaction', shardID).getStableTransactionsCount();
                }).then(_.sum),
                () => database.applyShards(shardID => {
                    return database.getRepository('transaction', shardID).getPendingTransactionsCount();
                }).then(_.sum)
            ],
            (fn, callback) => fn().then(result => callback(null, result)),
            (err, [transactionFreeCount, transactionIncludedCount, transactionInputCount, transactionOutputCount, transactionStableCount, transactionPendingCount]) => {
                res.send({
                    transaction_free_count    : transactionFreeCount,
                    transaction_included_count: transactionIncludedCount,
                    transaction_input_count   : transactionInputCount,
                    transaction_output_count  : transactionOutputCount,
                    transaction_stable_count  : transactionStableCount,
                    transaction_pending_count : transactionPendingCount
                });
            });
    }
};

export default new _C9rEOewwhQDijCnN();
