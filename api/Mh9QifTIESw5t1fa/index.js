import Endpoint from '../endpoint';
import database from '../../database/database';
import async from 'async';
import _ from 'lodash';
import fileManager from '../../core/storage/file-manager';
import wallet from '../../core/wallet/wallet';


/**
 * api get_transaction_output_data
 */
class _Mh9QifTIESw5t1fa extends Endpoint {
    constructor() {
        super('Mh9QifTIESw5t1fa');
        this.normalizationRepository = database.getRepository('normalization');
    }

    /**
     *
     * @param app
     * @param req (p0: transaction_id, p1: address_key_identifier, p2:
     *     attribute_type_id, p3: file_hash)
     * @param res
     */
    handler(app, req, res) {
        fileManager.getBufferByTransactionAndFileHash(req.query.p0, req.query.p1, req.query.p2, req.query.p3)
                   .then(({
                              file_data: fileData,
                              data_type: dataType,
                              mime_type: mimeType
                          }) => {

                       if (!fileData) {
                           return Promise.reject(`cannot get file data`);
                       }

                       if (dataType === 'json') {
                           res.setHeader('content-type', 'application/json');
                           return res.send(JSON.parse(fileData.toString()));
                       }

                       if (mimeType) {
                           res.setHeader('content-type', mimeType);
                       }
                       res.send(fileData);
                   })
                   .catch(e => res.send({
                       api_status : 'fail',
                       api_message: `unexpected generic api error: (${e})`
                   }));
    }
}


export default new _Mh9QifTIESw5t1fa();
