import database from '../../database/database';
import Endpoint from '../endpoint';
import server from '../server';
import network from '../../net/network';
import ntp from '../../core/ntp';
import _ from 'lodash';


/**
 * api support_shard
 */
class _FAow0eot8ZejZUTJ extends Endpoint {
    constructor() {
        super('FAow0eot8ZejZUTJ');
    }

    /**
     * adds support to an existent shard
     * @param app
     * @param req (p0: shard_id<required>, p1: shard_attribute={})
     * @param res
     */
    handler(app, req, res) {
        const shardID        = req.query.p0;
        const shardAttribute = req.query.p1 ? JSON.parse(req.query.p1) : {};
        if (!shardID) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<shard_id> is required'
            });
        }

        if (!database.shardExists(shardID)) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: `p0<${shardID}> does not exist`
            });
        }

        if (database.getShard(shardID)) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: `p0<${shardID}> already supported`
            });
        }

        const nodeID          = server.nodeID;
        const shardRepository = database.getRepository('shard');
        const nodeRepository  = database.getRepository('node');

        shardRepository.getShard({shard_id: shardID})
                       .then((shardInfo) => shardRepository.updateShardRequired(shardID, true).then(() => shardInfo))
                       .then((shardInfo) => database.addShard(shardInfo, true).then(() => shardInfo))
                       .then((shardInfo) => nodeRepository.getNodeAttribute(nodeID, 'shard_' + shardInfo.shard_type).then((shardAttributeList) => ([
                           shardAttributeList,
                           shardInfo
                       ])))
                       .then(([shardAttributeList, shardInfo]) => new Promise(resolve => {
                           if (shardAttributeList) {
                               shardAttributeList = JSON.parse(shardAttributeList);
                               _.each(shardAttributeList, attributeItem => {
                                   if (attributeItem.shard_id === shardInfo.shard_id) {
                                       Object.assign(attributeItem, shardAttribute);
                                       attributeItem.is_required = true;
                                   }
                               });
                           }
                           else {
                               shardAttributeList = [
                                   {
                                       'shard_id'         : shardInfo.shard_id,
                                       'transaction_count': 0,
                                       'update_date'      : Math.floor(ntp.now().getTime() / 1000),
                                       'is_required'      : true,
                                       ...shardAttribute
                                   }
                               ];
                           }
                           nodeRepository.addNodeAttribute(network.nodeID, 'shard_' + shardInfo.shard_type, JSON.stringify(shardAttributeList))
                                         .then(() => resolve()).catch(() => resolve());
                       }))
                       .then(() => res.send({'api_status': 'success'}))
                       .catch(e => res.send({
                           api_status : 'fail',
                           api_message: `unexpected generic api error: (${e})`
                       }));
    }
}


export default new _FAow0eot8ZejZUTJ();
