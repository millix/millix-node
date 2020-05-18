import Endpoint from '../endpoint';
import database from '../../database/database';
import async from 'async';


/**
 * api list_audit_verification
 */
class _VrLU9f2XYiMWfop4 extends Endpoint {
    constructor() {
        super('VrLU9f2XYiMWfop4');
    }

    /**
     * returns records from table audit_verification. it returns the newest
     * records by default
     * @param app
     * @param req (p0: attempt_count_min, p1: attempt_count_max, p2:
     *     verification_count_min, p3: verification_count_max, p4: is_verified,
     *     p5: verified_date_begin, p6: verified_date_end, p7:
     *     order_by="create_date desc", p8: record_limit=1000, p9: shard_id)
     * @param res
     */
    handler(app, req, res) {
        const orderBy = req.query.p7 || 'create_date desc';
        const limit   = parseInt(req.query.p8) || 1000;
        const shardID = req.query.p9;
        database.applyToShards((dbShardID) => {
            const auditVerificationRepository = database.getRepository('audit_verification', dbShardID);
            if (!auditVerificationRepository) {
                return Promise.resolve([]);
            }
            return auditVerificationRepository.listAuditVerification({
                attempt_count_min     : req.query.p0,
                attempt_count_max     : req.query.p1,
                verification_count_min: req.query.p2,
                verification_count_max: req.query.p3,
                is_verified           : req.query.p4,
                verified_date_begin   : req.query.p5,
                verified_date_end     : req.query.p6
            }, orderBy, limit, dbShardID);
        }, orderBy, limit, shardID).then(data => res.send(data));
    }
}


export default new _VrLU9f2XYiMWfop4();
