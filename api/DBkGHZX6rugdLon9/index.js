import Endpoint from '../endpoint';
import database from '../../database/database';


// api get_audit_verification
class _DBkGHZX6rugdLon9 extends Endpoint {
    constructor() {
        super('DBkGHZX6rugdLon9');
    }

    handler(app, req, res) {
        if (!req.query.p0) {
            return res.status(400).send({status: 'p0<transaction_id> is required'});
        }

        const auditVerificationRepository = database.getRepository('audit_verification');
        auditVerificationRepository.getAuditVerification(req.query.p0)
                                   .then(auditVerification => res.send(auditVerification || {}));
    }
}


export default new _DBkGHZX6rugdLon9();
