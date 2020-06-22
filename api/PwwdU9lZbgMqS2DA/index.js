import walletUtils from '../../core/wallet/wallet-utils';
import Endpoint from '../endpoint';
import database from '../../database/database';
import server from '../server';


/**
 * api register_node_identity
 */
class _PwwdU9lZbgMqS2DA extends Endpoint {
    constructor() {
        super('PwwdU9lZbgMqS2DA');
    }

    /**
     * this API pushes a value from the client node to the host node for it to
     * apply to its database. it upserts a record in the host node's table
     * node_attribute with attribute_type_id = node_public_key.  if a
     * corresponding node_id does not exist in table node, that is inserted as
     * well
     * @param app
     * @param req (p0: public_key<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (!req.query.p0) {
            return res.status(400).send({
                status : 'fail',
                message: 'p0<public_key> is required'
            });
        }
        try {
            if (!walletUtils.isValidNodeIdentity(req.params.nodeID, req.query.p0, server.nodeID, req.params.nodeSignature)) {
                return res.send({
                    status : 'fail',
                    message: 'node_registration_error'
                });
            }
            const nodeRepository = database.getRepository('node');
            nodeRepository.addNodeAttribute(req.params.nodeID, 'node_public_key', req.query.p0)
                          .then(() => {
                              res.send({status: 'success'});
                          })
                          .catch(() => {
                              res.send({
                                  status : 'fail',
                                  message: 'node_registration_error'
                              });
                          });
        }
        catch (e) {
            res.send({
                status : 'fail',
                message: 'node_registration_error'
            });
        }

    }
}


export default new _PwwdU9lZbgMqS2DA();
