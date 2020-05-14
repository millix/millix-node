import database from '../../database/database';
import Endpoint from '../endpoint';


/**
 * api list_shard
 */
class _OMAlxmPq4rZs71K8 extends Endpoint {
    constructor() {
        super('OMAlxmPq4rZs71K8');
    }

    /**
     * returns records from table shard. it returns the newest records by
     * default
     * @param app
     * @param req (p0: shard_type, p1: is_required, p2: node_id_origin, p3:
     *     status, p4: order_by="create_date desc", p5: record_limit=1000)
     * @param res
     */
    handler(app, req, res) {
        const orderBy         = req.query.p4 || 'create_date desc';
        const limit           = parseInt(req.query.p5) || 1000;
        const shardRepository = database.getRepository('shard');
        shardRepository.listShard({
            shard_type    : req.query.p0,
            is_required   : req.query.p1,
            node_id_origin: req.query.p2,
            status        : req.query.p3
        }, orderBy, limit).then(attributeList => {
            attributeList.forEach(attribute => attribute.schema_path = '${private_field}');
            res.send(attributeList);
        });
    }
}


export default new _OMAlxmPq4rZs71K8();
