import Endpoint from '../endpoint';
import database from '../../database/database';


// api get_audit_verification
class _VrLU9f2XYiMWfop4 extends Endpoint {
    constructor() {
        super('VrLU9f2XYiMWfop4');
    }

    handler(app, req, res) {
        const orderBy                     = req.query.p4;
        const limit                       = parseInt(req.query.p5) || 1000;
        const shardID                     = req.query.p6;
        const auditVerificationRepository = database.getRepository('audit_verification');
        auditVerificationRepository.listAuditVerification({
            attempt_count     : req.query.p0,
            verification_count: req.query.p1,
            is_verified       : req.query.p2,
            verified_date     : req.query.p3
        }, orderBy, limit, shardID)
                                   .then(auditVerificationList => res.send(auditVerificationList));
    }
}


export default new _VrLU9f2XYiMWfop4();
