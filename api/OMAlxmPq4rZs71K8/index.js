import database from '../../database/database';
import Endpoint from '../endpoint';


// api list_node_attribute
class _OMAlxmPq4rZs71K8 extends Endpoint {
    constructor() {
        super('OMAlxmPq4rZs71K8');
    }

    handler(app, req, res) {
        const orderBy         = req.query.p4;
        const limit           = parseInt(req.query.p5) || 1000;
        const shardRepository = database.getRepository('shard');
        shardRepository.listShard({
            shard_type    : req.query.p0,
            is_required   : req.query.p1,
            node_id_origin: req.query.p2,
            status        : req.query.p3
        }, orderBy, limit).then(attributeList => {
            attributeList.forEach(attribute => attribute.schema_path = '${private_field}')
            res.send(attributeList);
        });
    }
}


export default new _OMAlxmPq4rZs71K8();
