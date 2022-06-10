import database from '../../database/database';
import Endpoint from '../endpoint';
import path from 'path';
import os from 'os';
import config from '../../core/config/config';
import server from '../server';
import walletUtils from '../../core/wallet/wallet-utils';
import network from '../../net/network';
import ntp from '../../core/ntp';


/**
 * api add_shard
 */
class _aSiBLKkEsHI9lDr3 extends Endpoint {
    constructor() {
        super('aSiBLKkEsHI9lDr3');
    }

    /**
     * adds a new shard and returns the record
     * @param app
     * @param req (p0: shard_name<required>, p1: shard_type<required>, p2:
     *     is_required<required>, p3: schema_name, p4: schema_path, p5:
     *     shard_attribute={})
     * @param res
     */
    handler(app, req, res) {
        if (!req.query.p0 || !req.query.p1 || req.query.p2 === undefined) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<shard_name>, p1<shard_type> and p2<is_required> are required'
            });
        }

        const shardDate      = Math.floor(Date.now() / 1000);
        const nodeID         = server.nodeID;
        const schemaPath     = req.query.p4 || path.join(config.DATABASE_CONNECTION.FOLDER, 'shard/');
        const shardName      = req.query.p0;
        const shardType      = req.query.p1;
        const isRequired     = !!req.query.p2;
        const shardAttribute = req.query.p5 ? JSON.parse(req.query.p5) : {};
        const shardInfo      = walletUtils.getShardInfo(nodeID, shardDate, shardType, server.nodePrivateKey);
        const schemaName     = req.query.p3 || shardInfo.shard_id + '.sqlite';

        shardInfo['schema_path'] = schemaPath;
        shardInfo['schema_name'] = schemaName;

        const shardRepository = database.getRepository('shard');
        const nodeRepository  = database.getRepository('node');
        shardRepository.addShard(shardInfo.shard_id, shardName, shardType, schemaName, schemaPath, isRequired, nodeID, shardDate, shardInfo.node_signature)
                       .then(() => database.addShard(shardInfo, true))
                       .then(() => nodeRepository.getNodeAttribute(nodeID, 'shard_' + shardType))
                       .then(shardAttributeList => new Promise(resolve => {
                           if (shardAttributeList) {
                               shardAttributeList = JSON.parse(shardAttributeList);
                           }
                           else {
                               shardAttributeList = [];
                           }
                           nodeRepository.addNodeAttribute(network.nodeID, 'shard_' + shardType, JSON.stringify([
                               ...shardAttributeList,
                               {
                                   'shard_id'         : shardInfo.shard_id,
                                   'transaction_count': 0,
                                   'update_date'      : Math.floor(ntp.now().getTime() / 1000),
                                   'is_required'      : true,
                                   ...shardAttribute
                               }
                           ])).then(() => resolve()).catch(() => resolve());
                       }))
                       .then(() => shardRepository.getShard({shard_id: shardInfo.shard_id}))
                       .then(shardData => res.send(shardData))
                       .catch(e => res.send({
                           api_status : 'fail',
                           api_message: `unexpected generic api error: (${e})`
                       }));
    }
}


export default new _aSiBLKkEsHI9lDr3();
