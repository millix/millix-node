import Endpoint from '../endpoint';
import database from '../../database/database';
import peer from '../../net/peer';
import walletUtils from '../../core/wallet/wallet-utils';
import mutex from '../../core/mutex';
import genesisConfig from '../../core/genesis/genesis-config';
import async from 'async';


/**
 * api reprocess_database_transactions
 */
class _XVygz9vHv8cHTFf4 extends Endpoint {
    constructor() {
        super('XVygz9vHv8cHTFf4');
        this.resetState();
    }

    resetState(dataBegin) {
        this.transactionRepository                  = database.getRepository('transaction', genesisConfig.genesis_shard_id);
        this.lastProcessedTransactionSet            = new Set();
        this.lastMinuteProcessedTransactionTimeList = [];
        this.state                                  = {
            transaction_date_begin          : dataBegin,
            transaction_date_current        : dataBegin,
            transaction_date_last           : undefined,
            transaction_id_begin            : undefined,
            transaction_id_current          : undefined,
            transaction_id_last             : undefined,
            transaction_count_remaining     : 0,
            transaction_count_processed     : 0,
            transaction_count_total         : 0,
            transaction_processed_per_minute: 0,
            transaction_data_invalid_count  : 0,
            transaction_data_invalid_list   : [],
            time_remaining_estimate_minute  : undefined,
            running                         : false
        };
    }

    _processTransactionBatch(transactionList) {
        if (!this.state.running || !transactionList || transactionList.length === 0) {
            this.state.running = false;
            return;
        }

        const newProcessedTransactionSet = new Set();
        new Promise(resolve => {
            async.eachSeries(transactionList, (mTransaction, callback) => {
                if (this.lastProcessedTransactionSet.has(mTransaction.transaction_id)) {
                    return callback();
                }
                newProcessedTransactionSet.add(mTransaction.transaction_id);
                this.lastMinuteProcessedTransactionTimeList.push(Date.now());
                this.transactionRepository.getTransactionObjectFromDB(mTransaction.transaction_id)
                    .then(transaction => this.transactionRepository.normalizeTransactionObject(transaction))
                    .then(transaction => {
                        if (walletUtils.isValidTransactionObject(transaction)) {
                            return;
                        }

                        this.state.transaction_data_invalid_count++;
                        this.state.transaction_data_invalid_list.push(mTransaction.transaction_id);
                        // invalid transaction
                        return this.transactionRepository.deleteTransaction(mTransaction.transaction_id)
                                   .then(() => peer.transactionSyncRequest(mTransaction.transaction_id));
                    }).then(_ => callback()).catch(_ => callback());
            }, () => {
                while (true) {
                    const lastItem = this.lastMinuteProcessedTransactionTimeList[0];
                    if (!lastItem || lastItem > Date.now() - 60000) {
                        break;
                    }
                    this.lastMinuteProcessedTransactionTimeList.shift();
                }
                const lastTransaction                       = transactionList[transactionList.length - 1];
                this.state.transaction_id_current           = lastTransaction.transaction_id;
                this.state.transaction_date_current         = lastTransaction.transaction_date;
                this.state.transaction_count_processed += transactionList.length;
                this.state.transaction_count_remaining -= transactionList.length;
                this.state.transaction_processed_per_minute = this.lastMinuteProcessedTransactionTimeList.length;
                this.state.time_remaining_estimate_minute   = Math.ceil(this.state.transaction_count_remaining / this.state.transaction_processed_per_minute);
                this.lastProcessedTransactionSet            = newProcessedTransactionSet;
                this.transactionRepository.listTransactions({transaction_date_begin: Math.floor(lastTransaction.transaction_date.getTime() / 1000)}, 'transaction_date asc', 100)
                    .then(resolve)
                    .catch(() => resolve());
            });
        }).then(newTransactionList => this._processTransactionBatch(newTransactionList));
    }

    /**
     * returns a process to reprocess and validate transactions stored in
     * the db
     * @param app
     * @param req (p0: <action>, p1: <option_object>)
     * @param res
     */
    handler(app, req, res) {
        if (!req.query.p0) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<data_begin>  is required'
            });
        }

        const action = req.query.p0;

        if (action === 'state') {
            return res.send(this.state);
        }

        mutex.lock(['api_reprocess_database_transactions'], (unlock) => {
            Promise.resolve().then(() => {
                if (action === 'start') {
                    if (this.state.running === true) {
                        return res.status(400).send({
                            api_status : 'fail',
                            api_message: 'a database transaction reprocessing is already in progress'
                        });
                    }

                    if (!req.query.p0) {
                        return res.status(400).send({
                            api_status : 'fail',
                            api_message: 'p1<option_object> is required'
                        });
                    }

                    const options = JSON.parse(req.query.p1);
                    if (!options.date_begin) {
                        return res.status(400).send({
                            api_status : 'fail',
                            api_message: 'p1<options.date_begin> is required'
                        });
                    }

                    const dateBegin = parseInt(options.date_begin, 10);
                    this.resetState(new Date(dateBegin * 1000));

                    return this.transactionRepository.countAllTransactions()
                               .then(transactionCount => {
                                   this.state.transaction_count_total     = transactionCount;
                                   this.state.transaction_count_remaining = transactionCount;
                                   return this.transactionRepository.listTransactions({transaction_date_end: Math.floor(Date.now() / 1000)}, 'transaction_date desc', 1);
                               })
                               .then(([lastTransaction]) => {
                                   if (!lastTransaction) {
                                       this.resetState();
                                       throw Error('reprocess_database_transactions_start_error');
                                   }
                                   this.state.transaction_date_last = lastTransaction.transaction_date;
                                   this.state.transaction_id_last   = lastTransaction.transaction_id;
                                   return this.transactionRepository.listTransactions({transaction_date_begin: dateBegin}, 'transaction_date asc', 100);
                               })
                               .then((transactionList) => {
                                   if (!transactionList || transactionList.length === 0) {
                                       throw Error('reprocess_database_transactions_start_error');
                                   }
                                   const startTransaction              = transactionList[0];
                                   this.state.transaction_date_begin   = startTransaction.transaction_date;
                                   this.state.transaction_id_begin     = startTransaction.transaction_id;
                                   this.state.transaction_date_current = startTransaction.transaction_date;
                                   this.state.transaction_id_current   = startTransaction.transaction_id;
                                   this.state.running                  = true;
                                   this._processTransactionBatch(transactionList);
                                   res.send(this.state);
                               });
                }

                if (action === 'stop') {
                    this.state.running = false;
                    res.send(this.state);
                    return;
                }

                return res.status(400).send({
                    api_status : 'fail',
                    api_message: `p0<action> not recognized ${action}. accepted values: state, start, stop.`
                });
            }).then(() => unlock()).catch(e => {
                console.log(`[api ${this.endpoint}] error: ${e}`);
                unlock();
                res.send({
                    api_status : 'fail',
                    api_message: `unexpected generic api error: (${e.message})`
                });
            });
        });
    }

}


export default new _XVygz9vHv8cHTFf4();
