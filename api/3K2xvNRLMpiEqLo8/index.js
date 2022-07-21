import Endpoint from '../endpoint';
import database from '../../database/database';
import async from 'async';
import _ from 'lodash';
import fileManager from '../../core/storage/file-manager';
import wallet from '../../core/wallet/wallet';


/**
 * api get_transaction_output_key
 */
class _3K2xvNRLMpiEqLo8 extends Endpoint {
    constructor() {
        super('3K2xvNRLMpiEqLo8');
    }

    /**
     *
     * @param app
     * @param req (p0: transaction_id, p1:attribute_type_id, p2: file_hash)
     * @param res
     */
    handler(app, req, res) {
        fileManager.getKeyByTransactionAndFileHash(req.query.p0, req.query.p1, req.query.p2)
                   .then(key => {

                       if (!key) {
                           return Promise.reject(`cannot get file key`);
                       }

                       res.send({key});
                   })
                   .catch(e => res.send({
                       api_status : 'fail',
                       api_message: `unexpected generic api error: (${e})`
                   }));
    }
}


export default new _3K2xvNRLMpiEqLo8();
