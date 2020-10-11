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
                api_status : 'fail',
                api_message: 'p0<transaction_id> and p1<shard_id> are required'
            });
        }

        database.firstShardORShardZeroRepository('audit_verification', req.query.p1, (auditVerificationRepository) => {
            return auditVerificationRepository.getAuditVerification(req.query.p0, req.query.p1);
        }).then(auditVerification => res.send(auditVerification || {
            api_status : 'fail',
            api_message: `audit verification of transaction ${req.query.p0} was not found at shard with id ${req.query.p1}`
        })).catch(e => res.send({
            api_status : 'fail',
            api_message: `unexpected generic api error: (${e})`
        }));
    }
}


export default new _DBkGHZX6rugdLon9();
