import {Database} from '../database';
import console from '../../core/console';

export default class Shard {
    constructor(database) {
        this.database = database;
    }

    listShard(where, orderBy, limit) {
        return new Promise((resolve, reject) => {
            const {sql, parameters} = Database.buildQuery('SELECT * FROM shard', where, orderBy, limit);
            this.database.all(
                sql, parameters,
                (err, rows) => {
                    if (err) {
                        console.log(err);
                        return reject(err);
                    }

                    resolve(rows);
                }
            );
        });
    }

    addShard(shardID, shardName, shardType, schemaName, schemaPath, isRequired, nodeID, shardDate, nodeSignature) {
        return new Promise((resolve, reject) => {
            this.database.run(
                'INSERT INTO shard (shard_id, shard_name, shard_type, schema_name, schema_path, is_required, node_id_origin, shard_date, node_signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
                    shardID,
                    shardName,
                    shardType,
                    schemaName,
                    schemaPath,
                    isRequired,
                    nodeID,
                    shardDate,
                    nodeSignature
                ],
                (err) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve();
                }
            );
        });
    }

    getShard(where) {
        return new Promise((resolve, reject) => {
            const {sql, parameters} = Database.buildQuery('SELECT * FROM shard', where);
            this.database.get(
                sql, parameters,
                (err, row) => {
                    if (err) {
                        return reject(err);
                    }

                    resolve(row);
                }
            );
        });
    }

}
