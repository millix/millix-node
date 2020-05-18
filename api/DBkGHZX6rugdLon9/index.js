import Endpoint from '../endpoint';
import database from '../../database/database';


/**
 * api get_audit_verification
 */
class _DBkGHZX6rugdLon9 extends Endpoint {
    constructor() {
        super('DBkGHZX6rugdLon9');
    }

    /**
     * returns a single record from table audit_verification for the indicated
     * transaction_id located in the database schema indicated by shard_id.
     * @param app
     * @param req (p0: transaction_id<required>, p1: shard_id<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (!req.query.p0 || !req.query.p1) {
            return res.status(400).send({
                status : 'fail',
                message: 'p0<transaction_id> and p1<shard_id> are required'
            });
        }

        const auditVerificationRepository = database.getRepository('audit_verification');
        auditVerificationRepository.getAuditVerification(req.query.p0)
                                   .then(auditVerification => res.send(auditVerification || {}));
    }
}


export default new _DBkGHZX6rugdLon9();
