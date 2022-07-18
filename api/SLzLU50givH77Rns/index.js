import Endpoint from '../endpoint';
import database from '../../database/database';
import fileManager from '../../core/storage/file-manager';
import peer from '../../net/peer';
import fileSync from '../../core/storage/file-sync';


/**
 * api sync_transaction_output_data
 */
class _SLzLU50givH77Rns extends Endpoint {
    constructor() {
        super('SLzLU50givH77Rns');
        this.normalizationRepository = database.getRepository('normalization');
    }

    /**
     *
     * @param app
     * @param req (p0: transaction_id, p1: address_key_identifier, p2:
     *     attribute_type_id, p3: file_hash, p4: file_key)
     * @param res
     */
    handler(app, req, res) {
        const transactionId        = req.query.p0;
        const addressKeyIdentifier = req.query.p1;
        const attributeTypeId      = req.query.p2;
        fileManager.getBufferByTransactionAndFileHash(transactionId, addressKeyIdentifier, attributeTypeId, req.query.p3, req.query.p4)
                   .then(_ => {
                       return database.applyShards((shardID) => {
                           const transactionRepository = database.getRepository('transaction', shardID);
                           return transactionRepository.listTransactionOutputAttributes({
                               transaction_id   : transactionId,
                               attribute_type_id: attributeTypeId
                           });
                       }).then(attributes => {
                           for (const attribute of attributes) {
                               if (attribute.attribute_type_id === this.normalizationRepository.get('transaction_output_metadata')) {
                                   const transactionOutputMetadata = JSON.parse(attribute.value);
                                   res.send({
                                       status                     : 'synced',
                                       transaction_output_metadata: transactionOutputMetadata
                                   });
                                   return;
                               }
                           }

                           return Promise.reject('transaction_sync_fail');
                       });
                   })
                   .catch(e => {
                       return database.firstShards(shardId => {
                           const transactionRepository = database.getRepository('transaction', shardId);
                           return transactionRepository.getTransaction(transactionId);
                       }).then(transaction => {
                           if (!transaction) {
                               fileSync.addToPendingSync(transactionId);
                               peer.transactionSyncRequest(transactionId, {
                                   priority          : 1,
                                   dispatch_request  : true,
                                   force_request_sync: true
                               }).catch(_ => _);
                               res.send({
                                   status : 'syncing',
                                   trigger: 'transaction_not_found'
                               });
                               return;
                           }


                           return database.applyShards((shardID) => {
                               const transactionRepository = database.getRepository('transaction', shardID);
                               return transactionRepository.listTransactionOutputAttributes({
                                   transaction_id   : transactionId,
                                   attribute_type_id: attributeTypeId
                               });
                           }).then(attributes => {
                               for (const attribute of attributes) {
                                   if (attribute.attribute_type_id === this.normalizationRepository.get('transaction_output_metadata')) {
                                       const transactionOutputMetadata = JSON.parse(attribute.value);
                                       fileSync.add(transactionId, addressKeyIdentifier, transactionOutputMetadata, Math.floor(transaction.transaction_date.getTime() / 1000));
                                       res.send({
                                           status : 'syncing',
                                           trigger: e?.code === 'ENOENT' ? 'transaction_data_not_found' : e
                                       });
                                       return;
                                   }
                               }

                               return Promise.reject('transaction_sync_fail');
                           });

                       });
                   })
                   .catch(e => res.send({
                       api_status : 'fail',
                       api_message: `unexpected generic api error: (${e})`
                   }));
    }
}


export default new _SLzLU50givH77Rns();
