import database from '../../database/database';
import Endpoint from '../endpoint';


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
        const transactionRepository = database.getRepository('transaction');
        transactionRepository.getFreeTransactionsCount()
                             .then(transactionFreeCount =>
                                 transactionRepository.getIncludedTransactionsCount()
                                                      .then(transactionIncludedCount =>
                                                          transactionRepository.getInputsCount()
                                                                               .then(transactionInputCount =>
                                                                                   transactionRepository.getOutputsCount()
                                                                                                        .then(transactionOutputCount =>

                                                                                                            transactionRepository.getStableTransactionsCount()
                                                                                                                                 .then(transactionStableCount =>
                                                                                                                                     transactionRepository.getPendingTransactionsCount()
                                                                                                                                                          .then(transactionPendingCount =>
                                                                                                                                                              res.send({
                                                                                                                                                                  transaction_free_count    : transactionFreeCount,
                                                                                                                                                                  transaction_included_count: transactionIncludedCount,
                                                                                                                                                                  transaction_input_count   : transactionInputCount,
                                                                                                                                                                  transaction_output_count  : transactionOutputCount,
                                                                                                                                                                  transaction_stable_count  : transactionStableCount,
                                                                                                                                                                  transaction_pending_count : transactionPendingCount
                                                                                                                                                              })))))));
    }
};

export default new _C9rEOewwhQDijCnN();
