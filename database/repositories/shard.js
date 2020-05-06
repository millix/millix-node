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

}
