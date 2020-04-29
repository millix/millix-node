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
            let publicKey = walletUtils.publicKeyFromPem(req.query.p0.match(/.{1,64}/g).join('\n'));
            if (!walletUtils.isValidNodeSignature(req.params.nodeSignature, network.nodeID, publicKey)
                || walletUtils.getNodeIdFromPublicKey(publicKey) !== req.params.nodeID) {
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
