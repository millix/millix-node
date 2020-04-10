import database from '../../database/database';


// api get_node_summary
class _C9rEOewwhQDijCnN {
    constructor() {
        this.endpoint = 'C9rEOewwhQDijCnN';
    }

    register(app, apiURL) {
        const transactionRepository = database.getRepository('transaction');
        const addressRepository = database.getRepository('address');
        app.get(apiURL + this.endpoint, (req, res) => {
            transactionRepository.getFreeTransactionsCount()
                                 .then(transaction_free =>
                                     transactionRepository.getIncludedTransactionsCount()
                                                          .then(transaction_included =>
                                                              transactionRepository.getInputsCount()
                                                                                   .then(input =>
                                                                                       transactionRepository.getOutputsCount()
                                                                                                            .then(output =>
                                                                                                                addressRepository.getAddressesCount()
                                                                                                                                 .then(address =>
                                                                                                                                     transactionRepository.getStableTransactionsCount()
                                                                                                                                                          .then(transaction_stable =>
                                                                                                                                                              transactionRepository.getPendingTransactionsCount()
                                                                                                                                                                                   .then(transaction_pending =>
                                                                                                                                                                                       res.send({
                                                                                                                                                                                           transaction_free,
                                                                                                                                                                                           transaction_included,
                                                                                                                                                                                           input,
                                                                                                                                                                                           output,
                                                                                                                                                                                           address,
                                                                                                                                                                                           transaction_stable,
                                                                                                                                                                                           transaction_pending
                                                                                                                                                                                       }))))))));
        });
    }
};

export default new _C9rEOewwhQDijCnN();
