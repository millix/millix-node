import ntp from '../../core/ntp';
import console from '../../core/console';

export default class Node {
    constructor(database) {
        this.database = database;
    }

    eachNode(callback) {
        let sql = 'select * from node';
        this.database.each(sql, callback);
    }

    getNodes() {
        return new Promise(resolve => {
            this.database.all('select * from node', (err, rows) => {
                resolve(rows);
            });
        });
    }

    addNode(node) {
        let url = node.node_prefix + node.node_ip_address + ':' + node.node_port;
        return new Promise((resolve, reject) => {
            this.database.run('INSERT INTO node (node_prefix, node_ip_address, node_port, node_id) VALUES (?,?,?,?)', [
                node.node_prefix,
                node.node_ip_address,
                node.node_port,
                node.node_id
            ], (err) => {
                if (err) {
                    err.message.startsWith('SQLITE_CONSTRAINT') ? console.log(`[database] node ${url} already exits`) : console.error(err.message);
                    if (!node.node_id) {
                        return reject(err.message);
                    }
                    else {
                        this.database.run('UPDATE node SET node_id = ?, update_date = ? WHERE node_prefix = ? AND node_ip_address = ? AND node_port = ?', [
                            node.node_id,
                            Math.floor(ntp.now().getTime() / 1000),
                            node.node_prefix,
                            node.node_ip_address,
                            node.node_port
                        ], () => {
                            console.log(`[database] update node ${url} with id ${node.node_id}`);
                            return reject();
                        });
                        return;
                    }
                }
                resolve();
            });
        });
    }

    removeNode(node) {
        return new Promise((resolve, reject) => {
            let sql = 'delete from node where ip_address = ?';
            this.database.run(sql, [node.ip_address], (err) => {
                if (err) {
                    return reject(err.message);
                }
                resolve();
            });
        });
    }

}
