import walletUtils from '../../core/wallet/wallet-utils';
import Endpoint from '../endpoint';
import database from '../../database/database';


// api get_authentication_token
class _PwwdU9lZbgMqS2DA extends Endpoint {
    constructor() {
        super('PwwdU9lZbgMqS2DA');
    }

    handler(app, req, res) {
        try {
            if (!walletUtils.isValidNodeIdentity(req.params.nodeID, req.query.p0, network.nodeID, req.params.nodeSignature)) {
                return res.send({status: 'node_registration_error'});
            }
            const nodeRepository = database.getRepository('node');
            nodeRepository.addNodeAttribute(req.params.nodeID, 'node_public_key', req.query.p0)
                          .then(() => {
                              res.send({status: 'node_registration_success'});
                          })
                          .catch(() => {
                              res.send({status: 'node_registration_error'});
                          });
        }
        catch (e) {
            res.send({status: 'node_registration_error'});
        }

    }
}


export default new _PwwdU9lZbgMqS2DA();
