import database from '../../database/database';
import eventBus from '../event-bus';
import network from '../../net/network';
import peer from '../../net/peer';
import genesisConfig from '../genesis/genesis-config';
import config, {SHARD_ZERO_NAME} from '../config/config';
import async from 'async';
import _ from 'lodash';
import wallet, {WALLET_MODE} from './wallet';


export class WalletTransactionConsensus {

    constructor() {
        this._receivedConsensusTransactionValidation = null;
        this._requestConsensusTransactionValidation  = null;
        this._transactionValidationRejected          = new Set();
        this._transactionRetryValidation             = new Set();
        this._transactionValidationNotFound          = new Set();
    }

    initialize() {
        return Promise.resolve();
    }

    getRejectedTransactionList() {
        return this._transactionValidationRejected;
    }

    getRetryTransactionList() {
        return this._transactionRetryValidation;
    }

    removeFromRetryTransactions(transactionID) {
        delete this._transactionRetryValidation[transactionID];
    }

    removeFromRejectedTransactions(transactionID) {
        delete this._transactionValidationRejected[transactionID];
    }

    resetTransactionValidationRejected() {
        this._transactionValidationRejected = new Set();
    }

    _mapToAuditPointDistance(inputs) {
        return new Promise(resolve => {
            async.mapSeries(inputs, (input, callback) => {
                database.getRepository('transaction')
                        .getTransactionMinDistance(input.transaction_id, genesisConfig.genesis_transaction)
                        .then(distance => {
                            callback(null, {
                                input,
                                distance
                            });
                        });
            }, (err, results) => {
                console.log('[consensus][oracle] double spent check distance is ', results);
                resolve(results);
            });
        });
    }

    _getValidInputOnDoubleSpend(inputs) {
        return new Promise(resolve => {
            this._mapToAuditPointDistance(inputs)
                .then(inputs => {
                    let minDistance = _.minBy(_.map(inputs, i => i.distance));
                    _.remove(inputs, i => i.distance > minDistance);
                    inputs = _.map(inputs, e => e.input);

                    let validOutput;
                    if (inputs.length === 1) {
                        validOutput = inputs[0];
                    }
                    else {
                        // they have same distance pick the one with min hash
                        // value;
                        validOutput = _.minBy(inputs, i => i.transaction_id);
                    }
                    resolve(validOutput);
                });
        });
    }

    _setAsDoubleSpend(transactions, doubleSpendTransaction) {
        console.log('[consensus][oracle] setting ', transactions.length, ' transaction as double spend');
        async.eachSeries(transactions, (transaction, callback) => database.firstShards((shardID) => {
            return new Promise((resolve, reject) => {
                const transactionRepository = database.getRepository('transaction', shardID);
                transactionRepository.getTransactionObject(transaction.transaction_id)
                                     .then(transaction => transaction ? transactionRepository.setTransactionAsDoubleSpend(transaction, doubleSpendTransaction).then(() => resolve())
                                                                      : reject());
            });
        }).then(() => callback()));
    }

    _validateTransaction(transactionID, connectionID, depth, transactionVisitedList) {
        return new Promise((resolve, reject) => {
            database.firstShards((shardID) => {
                return new Promise((resolve, reject) => {
                    const transactionRepository = database.getRepository('transaction', shardID);
                    transactionRepository.getTransactionObject(transactionID)
                                         .then(transaction => transaction ? resolve([
                                             transaction,
                                             shardID
                                         ]) : reject());
                });
            }).then(data => {
                const [transaction, shardID] = data || [];
                if (!transaction) {
                    return [];
                }
                return database.getRepository('audit_point', shardID)
                               .getAuditPoint(transactionID)
                               .then(auditPoint => [
                                   transaction,
                                   auditPoint ? auditPoint.audit_point_id : undefined
                               ]);
            }).then(([transaction, auditPointID]) => {

                transactionVisitedList.add(transactionID);
                if (transaction && transaction.is_stable && _.every(transaction.transaction_output_list, output => output.is_stable && !output.is_double_spend)) {
                    console.log('[consensus][oracle] validated in consensus round after found a validated transaction at depth ', depth);
                    return resolve();
                }
                else if (auditPointID) {
                    console.log('[consensus][oracle] validated in consensus round after found in Local audit point ', auditPointID, ' at depth ', depth);
                    return resolve();
                }
                else if (!transaction) {
                    let ws = network.getWebSocketByID(connectionID);
                    if (ws) {
                        peer.transactionSyncByWebSocket(transactionID, ws);
                    }

                    wallet.requestTransactionFromNetwork(transactionID);

                    return reject({
                        cause              : 'transaction_not_found',
                        transaction_id_fail: transactionID,
                        message            : 'no information found for ' + transactionID
                    });
                }
                else if (transaction.transaction_id === genesisConfig.genesis_transaction) { //TODO: change to stable transactions
                    return resolve();
                }
                else if (depth === config.CONSENSUS_VALIDATION_REQUEST_DEPTH_MAX) {
                    return reject({
                        cause              : 'transaction_not_validated',
                        transaction_id_fail: transactionID,
                        message            : `not validated in a depth of ${depth}`
                    });
                }

                transaction = database.getRepository('transaction').normalizeTransactionObject(transaction);

                let sourceTransactions = new Set();
                let inputTotalAmount   = 0;
                // get inputs and check double
                // spend
                async.everySeries(transaction.transaction_input_list, (input, callback) => {
                    if (!transactionVisitedList.has(input.output_transaction_id)) {
                        sourceTransactions.add(input.output_transaction_id);
                    }

                    database.firstShards((shardID) => {
                        return new Promise((resolve, reject) => {
                            const transactionRepository = database.getRepository('transaction', shardID);
                            transactionRepository.isInputDoubleSpend(input, transaction.transaction_id)
                                                 .then(([isDoubleSpend, inputs]) => isDoubleSpend ? resolve([
                                                     isDoubleSpend,
                                                     inputs
                                                 ]) : reject());
                        });
                    }).then(data => data || []).then(([isDoubleSpend, inputs]) => {
                        if (isDoubleSpend) {
                            inputs.push({transaction_id: transaction.transaction_id, ...input});
                            this._getValidInputOnDoubleSpend(inputs)
                                .then(validInput => {

                                    if (validInput.transaction_id !== transaction.transaction_id) {
                                        return callback({
                                            cause              : 'double_spend',
                                            transaction_id_fail: input.output_transaction_id,
                                            message            : 'double spend found in ' + input.output_transaction_id
                                        }, false);
                                    }

                                    let doubleSpendInputs = _.pull(inputs, validInput);
                                    this._setAsDoubleSpend(doubleSpendInputs, input.output_transaction_id);
                                    return callback(null, true);
                                });
                        }
                        else {
                            // get
                            // the
                            // total
                            // millix
                            // amount
                            // of
                            // this
                            // input
                            database.firstShards((shardID) => {
                                return new Promise((resolve, reject) => {
                                    const transactionRepository = database.getRepository('transaction', shardID);
                                    transactionRepository.getOutput(input.output_transaction_id, input.output_position)
                                                         .then(output => output ? resolve(output) : reject());
                                });
                            }).then(output => {
                                if (!output) {
                                    let ws = network.getWebSocketByID(connectionID);
                                    if (ws) {
                                        peer.transactionSyncByWebSocket(input.output_transaction_id, ws);
                                    }

                                    wallet.requestTransactionFromNetwork(input.output_transaction_id);

                                    return callback({
                                        cause              : 'transaction_not_found',
                                        transaction_id_fail: input.output_transaction_id,
                                        message            : 'no information found for ' + input.output_transaction_id
                                    }, false);
                                }
                                inputTotalAmount += output.amount;
                                return callback(null, true);
                            })
                                    .catch(() => {
                                        return callback({
                                            cause              : 'peer_error',
                                            transaction_id_fail: transactionID,
                                            message            : 'generic database error when getting data for transaction id ' + input.output_transaction_id
                                        }, false);
                                    });
                        }
                    });
                }, (err, valid) => {
                    if (!valid) { //not valid
                        return reject(err);
                    }

                    if (!this._receivedConsensusTransactionValidation || (Date.now() - this._receivedConsensusTransactionValidation.timestamp) >= config.CONSENSUS_VALIDATION_WAIT_TIME_MAX) { //timeout has been triggered
                        return reject({
                            cause: 'consensus_timeout',
                            depth
                        });
                    }

                    // compare input and output
                    // amount
                    let outputTotalAmount = 0;
                    _.each(transaction.transaction_output_list, output => {
                        outputTotalAmount += output.amount;
                    });

                    if (outputTotalAmount > inputTotalAmount) {
                        return reject({
                            cause              : 'transaction_invalid_amount',
                            transaction_id_fail: transactionID,
                            message            : 'output amount is greater than input amount in transaction id ' + transactionID
                        });
                    }


                    // check inputs transactions
                    async.everySeries(sourceTransactions, (srcTransaction, callback) => {
                        this._validateTransaction(srcTransaction, connectionID, depth + 1, transactionVisitedList)
                            .then(() => callback(null, true))
                            .catch((err) => callback(err, false));
                    }, (err, valid) => {
                        if (!valid) {
                            return reject(err);
                        }
                        resolve();
                    });

                });
            });
        });
    }

    validateTransactionInConsensusRound(data, ws) {
        const node         = ws.node;
        const connectionID = ws.connectionID;

        const transactionID  = data.transaction_id;
        const consensusRound = data.consensus_round;

        console.log('[consensus][oracle] request received to validate transaction ', transactionID, ' for consensus round number ' + consensusRound);
        eventBus.emit('wallet_event_log', {
            type   : 'transaction_validation_request',
            content: data,
            from   : node
        });

        if (!this._receivedConsensusTransactionValidation ||
            !this._receivedConsensusTransactionValidation.ws ||
            this._receivedConsensusTransactionValidation.ws.nodeID !== ws.nodeID ||
            this._receivedConsensusTransactionValidation.transaction_id !== transactionID ||
            this._receivedConsensusTransactionValidation.consensus_round !== consensusRound) {
            console.log('[consensus][oracle] reject participation in consensus round. oracle already validating another transaction.');
            if (ws) {
                peer.transactionValidationResponse({
                    cause          : 'node_not_available',
                    message        : 'oracle already validating another transaction',
                    transaction_id : transactionID,
                    consensus_round: consensusRound,
                    valid          : false
                }, ws);
            }
            return;
        }

        this._receivedConsensusTransactionValidation['data'] = data;

        const transactionVisitedList = new Set();
        let depth                    = 0;


        this._validateTransaction(transactionID, connectionID, depth, transactionVisitedList)
            .then(() => {
                console.log('[consensus][oracle] transaction ', transactionID, ' was validated for a consensus');
                let ws = network.getWebSocketByID(connectionID);
                if (ws) {
                    peer.transactionValidationResponse({
                        transaction_id : transactionID,
                        consensus_round: consensusRound,
                        valid          : true
                    }, ws);
                }
                this._receivedConsensusTransactionValidation = null;
            })
            .catch((err) => {
                console.log('[consensus][oracle] consensus error: ', err);

                this._receivedConsensusTransactionValidation = null;
                if (err.cause === 'consensus_timeout') {
                    return;
                }

                let ws = network.getWebSocketByID(connectionID);
                if (ws) {
                    peer.transactionValidationResponse({
                        ...err,
                        transaction_id : transactionID,
                        consensus_round: consensusRound,
                        valid          : false
                    }, ws);
                }
            });

    }

    _selectNodesForConsensusRound(numberOfNodes = config.CONSENSUS_ROUND_NODE_COUNT, excludeNodeList = []) {
        return new Promise(resolve => {
            resolve(_.sampleSize(_.difference(network.registeredClients, excludeNodeList), numberOfNodes));
        });
    }

    _resetValidationRound() {
        return new Promise((resolve) => {
            if (!this._requestConsensusTransactionValidation || this._requestConsensusTransactionValidation.resetting) {
                return resolve();
            }
            this._releaseAllocatedNodes();
            this._requestConsensusTransactionValidation['nodes']     = {};
            this._requestConsensusTransactionValidation['resetting'] = true;
            setTimeout(() => {
                if (!this._requestConsensusTransactionValidation || !this._requestConsensusTransactionValidation['run']) {
                    return resolve();
                }
                this._requestConsensusTransactionValidation['resetting'] = false;
                console.log('[consensus][request] restarting consensus validation round');
                this._requestConsensusTransactionValidation['run']().then(() => resolve());
            }, 5000);
        });
    }

    _askNodeToValidateTransaction(ws) {
        const transaction   = this._requestConsensusTransactionValidation['transaction'];
        const transactionID = transaction.transaction_id;

        if (!ws || !ws.node) {
            console.log('[consensus][request] warn: tried to ask a disconnected node for transaction validation');
            return Promise.reject();
        }

        peer.transactionSendToNode({transaction}, ws);

        console.log('[consensus][request] ask ', ws.node, ' for transaction validation');
        this._requestConsensusTransactionValidation.nodes[ws.node] = {replied: false};
        return peer.transactionValidationRequest({
            transaction_id : transactionID,
            consensus_round: this._requestConsensusTransactionValidation.consensus_round
        }, ws);
    }

    _allocateNodeToValidateTransaction(ws) {

        if (!ws || !ws.node) {
            console.log('[consensus][request] warn: tried to allocate a disconnected node for transaction validation');
            return this._replaceNodeInConsensusRound(ws);
        }

        console.log('[consensus][request] allocating ', ws.node, ' for a transaction validation');
        const consensusRound = this._requestConsensusTransactionValidation.consensus_round;
        const transactionID  = this._requestConsensusTransactionValidation.transaction.transaction_id;

        return new Promise((resolve, reject) => {
            peer.allocateNodeToValidateTransaction({
                consensus_round: consensusRound,
                transaction_id : transactionID
            }, ws)
                .then(resolve)
                .catch(() => {
                    console.log('[consensus][request] warn: node didnt reply to allocation for transaction validation. replacing node.');
                    this._replaceNodeInConsensusRound(ws)
                        .then(resolve)
                        .catch(() => {
                            reject();
                        });
                });
        });
    }

    _replaceNodeInConsensusRound(oldWS) {
        if (!this._requestConsensusTransactionValidation || !this._requestConsensusTransactionValidation.nodes_candidate || !this._requestConsensusTransactionValidation.nodes_candidate_discarded) {
            return Promise.reject();
        }
        _.pull(this._requestConsensusTransactionValidation.nodes_candidate, oldWS);
        this._requestConsensusTransactionValidation.nodes_candidate_discarded.push(oldWS);
        return this._selectNodesForConsensusRound(1, this._requestConsensusTransactionValidation.nodes_candidate.concat(this._requestConsensusTransactionValidation.nodes_candidate_discarded))
                   .then(candidate => {
                       const ws = _.head(candidate);
                       if (ws) {
                           console.log('[consensu][request] new node available', ws.node);
                           this._requestConsensusTransactionValidation['nodes_candidate'].push(ws);
                           return this._allocateNodeToValidateTransaction(ws);
                       }
                       else {
                           console.log('[consensus][request] no more nodes available');
                           return Promise.reject();
                       }
                   });
    }

    _startConsensusRound(transactionID) {
        return new Promise(resolve => {
            database.firstShards((shardID) => {
                return new Promise((resolve, reject) => {
                    const transactionRepository = database.getRepository('transaction', shardID);
                    transactionRepository.getTransactionObject(transactionID)
                                         .then(transaction => transaction ? resolve(transaction) : reject());
                });
            }).then(dbTransaction => database.getRepository('transaction').normalizeTransactionObject(dbTransaction))
                    .then(transaction => wallet.getWalletAddresses().then(addresses => [
                        transaction,
                        addresses
                    ]))
                    .then(([transaction, addresses]) => {

                        if (!transaction) { // transaction data not found
                            delete this._transactionRetryValidation[transactionID];
                            return resolve();
                        }

                        addresses = addresses.map(address => address.address_base);

                        console.log('[consensus][request]', transactionID, ' is ready for consensus round');
                        if (transactionID === genesisConfig.genesis_transaction
                            || (transaction.transaction_signature_list.length === 1 && transaction.transaction_output_list.length === 1 //self-transaction
                                && transaction.transaction_signature_list[0].address_base === transaction.transaction_output_list[0].address_base
                                && addresses.includes(transaction.transaction_signature_list[0].address_base))) {
                            delete this._transactionRetryValidation[transactionID];
                            return database.applyShardZeroAndShardRepository('transaction', transaction.shard_id, transactionRepository => {
                                return transactionRepository.setTransactionAsStable(transactionID)
                                                            .then(() => transactionRepository.setOutputAsStable(transactionID))
                                                            .then(() => transactionRepository.setInputsAsSpend(transactionID));
                            });
                        }

                        this._requestConsensusTransactionValidation['run'] = () => {
                            return new Promise(resolveRun => {
                                this._requestConsensusTransactionValidation['nodes_candidate_discarded'] = [];
                                this._selectNodesForConsensusRound()
                                    .then(selectedNodeList => {
                                        if (selectedNodeList.length !== config.CONSENSUS_ROUND_NODE_COUNT) {
                                            console.log('[consensus][request] no node ready for this consensus round');
                                            delete this._transactionRetryValidation[transactionID];
                                            return resolveRun();
                                        }

                                        if (!this._requestConsensusTransactionValidation || this._requestConsensusTransactionValidation.transaction_id !== transactionID) {
                                            console.log('[consensus][request] no consensus round found for transaction ', transactionID);
                                            return resolveRun();
                                        }

                                        this._requestConsensusTransactionValidation['nodes']           = {};
                                        this._requestConsensusTransactionValidation['timestamp']       = new Date().getTime();
                                        this._requestConsensusTransactionValidation['nodes_candidate'] = selectedNodeList;
                                        this._requestConsensusTransactionValidation['transaction']     = transaction;

                                        const onNodeAllocationResponse = ([data, ws]) => {

                                            if (!this._requestConsensusTransactionValidation || this._requestConsensusTransactionValidation.transaction_id !== transactionID ||
                                                !this._requestConsensusTransactionValidation.nodes ||
                                                !this._requestConsensusTransactionValidation.nodes[ws.node] ||
                                                this._requestConsensusTransactionValidation.consensus_round !== data.consensus_round ||
                                                this._requestConsensusTransactionValidation.transaction_id !== data.transaction_id ||
                                                this._requestConsensusTransactionValidation.nodes[ws.node] && this._requestConsensusTransactionValidation.nodes[ws.node].allocated) {
                                                return this._replaceNodeInConsensusRound(ws).then(data => onNodeAllocationResponse(data));
                                            }

                                            console.log('[consensus][request] received allocation response from ', ws.node);

                                            eventBus.emit('wallet_event_log', {
                                                type   : 'transaction_validation_node_allocate_response',
                                                content: data,
                                                from   : ws.node
                                            });

                                            if (!data.allocated) {
                                                console.log('[consensus][request] node allocation failed for ', ws.node);
                                                return this._replaceNodeInConsensusRound(ws).then(data => onNodeAllocationResponse(data));
                                            }

                                            console.log('[consensus][request] node allocation success for ', ws.node);
                                            this._requestConsensusTransactionValidation.nodes[ws.node] = {allocated: true};

                                            peer.acknowledgeAllocateNodeToValidateTransaction({
                                                transaction_id : transactionID,
                                                consensus_round: this._requestConsensusTransactionValidation.consensus_round
                                            }, ws);

                                            let allocatedNodeCount = 0;
                                            for (let wsNode of _.keys(this._requestConsensusTransactionValidation.nodes)) {
                                                if (!this._requestConsensusTransactionValidation.nodes[wsNode].allocated) {
                                                    return Promise.resolve();
                                                }
                                                allocatedNodeCount++;
                                            }

                                            if (allocatedNodeCount === config.CONSENSUS_ROUND_NODE_COUNT) {
                                                return this._requestConsensusTransactionValidationFromAllocatedNodes(transaction);
                                            }
                                            else {
                                                return Promise.reject();
                                            }
                                        };
                                        async.each(selectedNodeList, (ws, callback) => {
                                            this._requestConsensusTransactionValidation.nodes[ws.node] = {allocated: false};
                                            this._allocateNodeToValidateTransaction(ws)
                                                .then((data) => onNodeAllocationResponse(data))
                                                .then(() => callback())
                                                .catch(() => callback(true));
                                        }, err => {
                                            if (err) {
                                                this._resetValidationRound()
                                                    .then(() => resolveRun());
                                            }
                                            else {
                                                resolveRun();
                                            }
                                        });
                                    });
                            });
                        };

                        this._requestConsensusTransactionValidation['run']().then(() => resolve());

                    })
                    .catch(() => resolve());
        });
    }

    _releaseAllocatedNodes() {
        const transactionID  = this._requestConsensusTransactionValidation.transaction.transaction_id;
        const consensusRound = this._requestConsensusTransactionValidation.consensus_round;
        for (let wsNode of _.keys(this._requestConsensusTransactionValidation.nodes)) {
            if (this._requestConsensusTransactionValidation.nodes[wsNode].allocated) {
                const ws = _.find(this._requestConsensusTransactionValidation.nodes_candidate, ws => ws.node == wsNode);
                if (ws) {
                    peer.releaseNodeToValidateTransaction({
                        transaction_id : transactionID,
                        consensus_round: consensusRound
                    }, ws);
                }
            }
        }
    }

    releaseNodeToValidateTransaction(data, ws) {
        if (!this._receivedConsensusTransactionValidation ||
            !this._receivedConsensusTransactionValidation.ws ||
            this._receivedConsensusTransactionValidation.ws.nodeID !== ws.nodeID ||
            this._receivedConsensusTransactionValidation.transaction_id !== data.transaction_id ||
            this._receivedConsensusTransactionValidation.consensus_round !== data.consensus_round) {
            console.log('[consensus][oracle] received invalid request to release node from consensus round.');
            return;
        }

        this._receivedConsensusTransactionValidation = null;
    }

    allocateNodeToValidateTransaction(data, ws) {
        if (this._receivedConsensusTransactionValidation) {
            peer.replyNodeAllocationRequest({
                ...data,
                allocated: false
            }, ws).catch(() => {
            });
        }
        else {
            this._receivedConsensusTransactionValidation = {
                ...data,
                timestamp: Date.now(),
                ws
            };
            peer.replyNodeAllocationRequest({
                ...data,
                allocated: true
            }, ws)
                .catch(() => {
                    console.log('[consensus][oracle] release node allocation after timeout... acknowledge not received');
                    this._receivedConsensusTransactionValidation = null;
                });
        }
    }

    _requestConsensusTransactionValidationFromAllocatedNodes(transaction) {
        const transactionID = transaction.transaction_id;
        return new Promise((resolve, reject) => {
            const onNodeValidationResponse = ([data, ws]) => {

                return new Promise((resolveValidation, rejectValidation) => {

                    if (!this._requestConsensusTransactionValidation || this._requestConsensusTransactionValidation.transaction_id !== transactionID || !this._requestConsensusTransactionValidation.nodes ||
                        !this._requestConsensusTransactionValidation.nodes[ws.node] || this._requestConsensusTransactionValidation.consensus_round !== data.consensus_round ||
                        this._requestConsensusTransactionValidation.nodes[ws.node].replied) {
                        return resolveValidation();
                    }

                    console.log('[consensus][request] received reply for this consensus round from ', ws.node);

                    eventBus.emit('wallet_event_log', {
                        type   : 'transaction_validation_response',
                        content: data,
                        from   : ws.node
                    });

                    if (data.cause === 'node_not_available') {
                        return rejectValidation();
                    }

                    this._requestConsensusTransactionValidation.nodes[ws.node]['data']    = data;
                    this._requestConsensusTransactionValidation.nodes[ws.node]['replied'] = true;

                    if (data.cause === 'double_spend') {
                        this._requestConsensusTransactionValidation.double_spend_count++;
                        if (this._requestConsensusTransactionValidation.double_spend_count >= config.CONSENSUS_ROUND_DOUBLE_SPEND_MAX) {
                            this._releaseAllocatedNodes();
                            delete this._transactionRetryValidation[transactionID];
                            this._transactionValidationRejected.add(transactionID);
                            console.log('[consensus][request] the transaction ', transactionID, ' was not validated (due to double spend) during consensus round number ', this._requestConsensusTransactionValidation.consensus_round);
                            database.applyShardZeroAndShardRepository('transaction', transaction.shard_id, transactionRepository => {
                                return transactionRepository.setTransactionAsDoubleSpend(transaction, data.transaction_id_fail /*double spend input*/);
                            }).then(() => wallet._checkIfWalletUpdate(_.map(transaction.transaction_output_list, o => o.address_base + o.address_version + o.address_key_identifier)))
                                    .then(() => {
                                        delete this._transactionRetryValidation[transactionID];
                                        resolveValidation();
                                    })
                                    .catch(() => {
                                        delete this._transactionRetryValidation[transactionID];
                                        resolveValidation();
                                    });
                            return;
                        }
                    }
                    else if (data.cause === 'transaction_not_found' && transaction && transaction.transaction_id === data.transaction_id_fail) {
                        peer.transactionSendToNode(transaction, ws);
                    }

                    let validationCount     = 0;
                    let transactionNotFound = true;
                    for (let wsNode of _.keys(this._requestConsensusTransactionValidation.nodes)) {
                        if (this._requestConsensusTransactionValidation.nodes[wsNode].replied === false) {
                            return resolveValidation();
                        }

                        if (this._requestConsensusTransactionValidation.nodes[wsNode].data.valid) {
                            validationCount += 1;
                        }

                        transactionNotFound = transactionNotFound && this._requestConsensusTransactionValidation.nodes[wsNode].data.cause === 'transaction_not_found';
                    }

                    let valid = validationCount >= 2 / 3 * config.CONSENSUS_ROUND_NODE_COUNT;

                    if (!valid) {
                        console.log('[consensus][request] the transaction ', transactionID, ' was not validated during consensus round number ', this._requestConsensusTransactionValidation.consensus_round);
                        if (transactionNotFound) {
                            if (this._transactionValidationNotFound[transactionID]) {
                                this._transactionValidationNotFound[transactionID] += 1;
                                if (this._transactionValidationNotFound[transactionID] >= config.CONSENSUS_ROUND_NOT_FOUND_MAX) {
                                    console.log('[consensus][request] the transaction ', transactionID, ' was not validated (due to not found reply) during consensus round number ', this._requestConsensusTransactionValidation.consensus_round);
                                    this._releaseAllocatedNodes();
                                    delete this._transactionRetryValidation[transactionID];
                                    this._transactionValidationRejected.add(transactionID);
                                    return database.applyShardZeroAndShardRepository('transaction', transaction.shard_id, transactionRepository => {
                                        return transactionRepository.timeoutTransaction(transactionID);
                                    }).then(() => {
                                        return resolveValidation();
                                    });
                                }
                            }
                            else {
                                this._transactionValidationNotFound[transactionID] = 1;
                            }
                        }

                        this._requestConsensusTransactionValidation.consensus_round += 1;
                        if (this._requestConsensusTransactionValidation.consensus_round >= config.CONSENSUS_ROUND_VALIDATION_MAX) {
                            this._releaseAllocatedNodes();
                            this._transactionValidationRejected.add(transactionID);
                            return resolveValidation();
                        }
                        return rejectValidation();
                    }
                    else {
                        this._releaseAllocatedNodes();
                        console.log('[consensus][request] transaction ', transactionID, ' validated after receiving all replies for this consensus round');
                        return database.applyShardZeroAndShardRepository('transaction', transaction.shard_id, transactionRepository => {
                            return transactionRepository.setPathAsStableFrom(transactionID);
                        }).then(() => wallet._checkIfWalletUpdate(_.map(transaction.transaction_output_list, o => o.address_base + o.address_version + o.address_key_identifier)))
                                       .then(() => {
                                           delete this._transactionRetryValidation[transactionID];
                                           resolveValidation();
                                       }).catch(() => {
                                delete this._transactionRetryValidation[transactionID];
                                resolveValidation();
                            });
                    }
                });
            };

            async.each(this._requestConsensusTransactionValidation.nodes_candidate, (ws, callback) => {
                this._askNodeToValidateTransaction(ws)
                    .then((data) => onNodeValidationResponse(data))
                    .then(() => callback())
                    .catch(() => callback(true));
            }, err => {
                if (err) {
                    reject();
                }
                else {
                    resolve();
                }
            });
        });
    }

    doConsensusTransactionValidationWatchDog() {
        let transactionID = this._requestConsensusTransactionValidation ? this._requestConsensusTransactionValidation.transaction_id : null;
        if (transactionID && (new Date().getTime() - this._requestConsensusTransactionValidation.timestamp) >= config.CONSENSUS_VALIDATION_WAIT_TIME_MAX) {
            console.log('[consensus][watchdog] killed by watch dog txid: ', transactionID, 'round:', this._requestConsensusTransactionValidation.consensus_round);
            this._requestConsensusTransactionValidation.consensus_round += 1;
            if (this._requestConsensusTransactionValidation.consensus_round === config.CONSENSUS_ROUND_VALIDATION_MAX) {
                this._requestConsensusTransactionValidation.resolve();
                this._requestConsensusTransactionValidation = null;
                this._transactionValidationRejected.add(transactionID);
            }
            else {
                this._requestConsensusTransactionValidation.run();
            }
        }

        if (this._receivedConsensusTransactionValidation && (Date.now() - this._receivedConsensusTransactionValidation.timestamp) >= config.CONSENSUS_VALIDATION_WAIT_TIME_MAX) {
            this._receivedConsensusTransactionValidation = null;
        }

        return Promise.resolve();
    }

    doValidateTransaction() {
        if (this._requestConsensusTransactionValidation !== null) {
            console.log('[consensus][request] a consensus round is running', this._requestConsensusTransactionValidation);
            return Promise.resolve();
        }

        this._requestConsensusTransactionValidation                       = {};
        this._requestConsensusTransactionValidation['consensus_round']    = 0;
        this._requestConsensusTransactionValidation['double_spend_count'] = 0;

        let excludeTransactionList = Array.from(this._transactionValidationRejected.keys());
        if (excludeTransactionList.length > 900) { //max sqlite parameters are 999
            excludeTransactionList = _.sample(excludeTransactionList, 900);
        }

        console.log('[consensus][request] get unstable transactions');
        return new Promise(resolve => {
            database.getRepository('keychain')
                    .getWalletAddresses(wallet.getDefaultActiveWallet())
                    .then(addresses => {
                        return database.applyShards((shardID) => {
                            return database.getRepository('transaction', shardID)
                                           .getAddressesUnstableTransactions(addresses.map(address => address.address), config.CONSENSUS_ROUND_PATH_LENGTH_MIN, excludeTransactionList);
                        });
                    })
                    .then(pendingTransactions => {
                        if (pendingTransactions.length === 0) {
                            return database.applyShards((shardID) => {
                                return database.getRepository('transaction', shardID)
                                               .findUnstableTransaction(config.CONSENSUS_ROUND_PATH_LENGTH_MIN, excludeTransactionList);
                            }).then(transactions => [
                                transactions,
                                false
                            ]);
                        }
                        else {
                            return [
                                pendingTransactions,
                                true
                            ];
                        }
                    })
                    .then(([pendingTransactions, isNodeTransaction]) => {
                        console.log('[consensus][request] get unstable transactions done');
                        let rejectedTransactions = _.remove(pendingTransactions, t => this._transactionValidationRejected.has(t.transaction_id));
                        let pendingTransaction   = pendingTransactions[0];

                        if (!pendingTransaction) {
                            pendingTransaction = rejectedTransactions[0];
                        }

                        if (!pendingTransaction) {
                            console.log('[consensus][request] no pending funds available for validation.');
                            this._requestConsensusTransactionValidation = null;
                            return resolve();
                        }

                        console.log('[consensus][request] starting consensus round for ', pendingTransaction.transaction_id);

                        if (isNodeTransaction) {
                            this._transactionRetryValidation[pendingTransaction.transaction_id] = Date.now();
                        }

                        this._requestConsensusTransactionValidation['transaction_id'] = pendingTransaction.transaction_id;
                        this._requestConsensusTransactionValidation['resolve']        = resolve;
                        return this._startConsensusRound(pendingTransaction.transaction_id).then(() => {
                            this._requestConsensusTransactionValidation = null;
                            resolve();
                        });
                    })
                    .catch(() => {
                        this._requestConsensusTransactionValidation = null;
                        resolve();
                    });
        });
    }

}


export default new WalletTransactionConsensus();
