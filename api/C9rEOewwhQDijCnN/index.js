import database from '../../database/database';


// api get_node_summary
class _C9rEOewwhQDijCnN {
    constructor() {
        this.endpoint = 'C9rEOewwhQDijCnN';
    }

    register(app, apiURL) {
        const transactionRepository = database.getRepository('transaction');
        const addressRepository     = database.getRepository('address');
        app.get(apiURL + this.endpoint, (req, res) => {
            transactionRepository.getFreeTransactionsCount()
                                 .then(transactionFreeCount =>
                                     transactionRepository.getIncludedTransactionsCount()
                                                          .then(transactionIncludedCount =>
                                                              transactionRepository.getInputsCount()
                                                                                   .then(transactionInputCount =>
                                                                                       transactionRepository.getOutputsCount()
                                                                                                            .then(transactionOutputCount =>
                                                                                                                addressRepository.getAddressesCount()
                                                                                                                                 .then(addressCount =>
                                                                                                                                     transactionRepository.getStableTransactionsCount()
                                                                                                                                                          .then(transactionStableCount =>
                                                                                                                                                              transactionRepository.getPendingTransactionsCount()
                                                                                                                                                                                   .then(transactionPendingCount =>
                                                                                                                                                                                       res.send({
                                                                                                                                                                                           transaction_free_count    : transactionFreeCount,
                                                                                                                                                                                           transaction_included_count: transactionPendingCount,
                                                                                                                                                                                           transaction_input_count   : transactionInputCount,
                                                                                                                                                                                           transaction_output_count  : transactionOutputCount,
                                                                                                                                                                                           address_count             : addressCount,
                                                                                                                                                                                           transaction_stable_count  : transactionStableCount,
                                                                                                                                                                                           transaction_pending_count : transactionPendingCount
                                                                                                                                                                                       }))))))));
        });
    }
};

export default new _C9rEOewwhQDijCnN();
