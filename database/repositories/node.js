import ntp from '../../core/ntp';
import console from '../../core/console';
import {Database} from '../database';
import _ from 'lodash';

export default class Node {
    constructor(database) {
        this.database                = database;
        this.normalizationRepository = null;
    }

    setNormalizationRepository(repository) {
        this.normalizationRepository = repository;
    }

    addNodeAttributeType(attributeType) {
        return new Promise((resolve, reject) => {
            let nodeAttributeID = this.normalizationRepository.get(attributeType);
            if (!nodeAttributeID) {
                nodeAttributeID = Database.generateID(20);
            }
            this.database.run('INSERT INTO node_attribute_type (attribute_type_id, attribute_type) VALUES (?, ?)',
                [
                    nodeAttributeID,
                    attributeType
                ], (err) => {
                    if (err) {
                        this.database.get('SELECT attribute_type_id FROM node_attribute_type WHERE attribute_type = ?',
                            [attributeType], (err, row) => {
                                if (!row) {
                                    console.log("[node] unexpected error ", err, "attribute ", attributeType, " value", row);
                                    return reject(err);
                                }
                                resolve(row.attribute_type_id);
                            });
                        return;
                    }
                    resolve(nodeAttributeID);
                });
        });
    }

    getNodeAttribute(nodeID, attributeType) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT a.value FROM node_attribute a INNER JOIN node_attribute_type t on a.attribute_type_id = t.attribute_type_id WHERE t.attribute_type = ? AND a.node_id = ?',
                [
                    attributeType,
                    nodeID
                ], (err, row) => {
                    if (err) {
                        return reject();
                    }
                    resolve(row ? row.value : undefined);
                });
        });
    }

    getNodeAttributeByAttributeID(nodeID, attributeID) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT value FROM node_attribute  WHERE attribute_type_id = ? AND node_id = ?',
                [
                    attributeID,
                    nodeID
                ], (err, row) => {
                    if (err) {
                        return reject();
                    }
                    resolve(row ? row.value : undefined);
                });
        });
    }

    addNodeAttribute(nodeID, attributeType, attributeValue) {
        return this.addNodeAttributeType(attributeType)
                   .then(attributeTypeID => {
                       return new Promise((resolve, reject) => {
                           this.database.run('INSERT OR REPLACE INTO node_attribute (node_id, attribute_type_id, value) VALUES (?,?,?)',
                               [
                                   nodeID,
                                   attributeTypeID,
                                   attributeValue
                               ],
                               (err) => {
                                   if (err) {
                                       return reject(err.message);
                                   }
                                   resolve();
                               });
                       });
                   });
    }

    getConnectionStatistics() {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT COUNT(CASE WHEN update_date > strftime("%s","now", "-1 day") THEN 1 ELSE NULL END) AS peer_connection_count_day,\n' +
                              'COUNT(CASE WHEN update_date > strftime("%s","now", "-1 hour") THEN 1 ELSE NULL END) AS peer_connection_count_hour,\n' +
                              'COUNT(CASE WHEN update_date > strftime("%s","now", "-1 minute") THEN 1 ELSE NULL END) AS peer_connection_count_minute\n' +
                              'FROM node', (err, row) => {
                if (err) {
                    return reject(err.message);
                }
                resolve(row);
            });
        });
    }

    eachNode(callback) {
        let sql = 'select * from node';
        this.database.each(sql, callback);
    }

    listNodeAttribute(where, orderBy, limit) {
        return new Promise((resolve, reject) => {
            let {
                    sql,
                    parameters
                } = Database.buildQuery('SELECT nat.attribute_type, node_attribute.* FROM node_attribute INNER JOIN node_attribute_type AS nat ON node_attribute.attribute_type_id = nat.attribute_type_id', where, orderBy, limit);
            this.database.all(sql, parameters, (err, rows) => {
                if (err) {
                    return reject(err);
                }
                rows.forEach(row => {
                    try {
                        row.value = JSON.parse(row.value);
                    }
                    catch (e) {
                    }
                });
                resolve(rows);
            });
        });
    }

    listNodes(where, orderBy, limit) {
        return new Promise(resolve => {
            let {
                    sql,
                    parameters
                } = Database.buildQuery('SELECT * FROM node', where, orderBy, limit);
            this.database.all(sql, parameters, (err, rows) => {
                resolve(rows);
            });
        });
    }

    getNode(where) {
        return new Promise(resolve => {
            let {
                    sql,
                    parameters
                } = Database.buildQuery('SELECT * FROM node', where);
            this.database.get(sql, parameters, (err, row) => {
                resolve(row);
            });
        });
    }

    listNodesExtended() {
        return new Promise(resolve => {
            this.database.all('SELECT node.*,\n' +
                              'node_attribute.attribute_type_id, node_attribute.value, node_attribute.status as attribute_status, node_attribute.create_date as attribute_create_date,\n' +
                              'node_attribute_type.attribute_type FROM node\n' +
                              'LEFT JOIN node_attribute ON node.node_id = node_attribute.node_id\n' +
                              'LEFT JOIN node_attribute_type ON node_attribute_type.attribute_type_id = node_attribute.attribute_type_id',
                (err, rows) => {
                    resolve(rows || []);
                });
        });
    }

    addNode(node) {
        let url = node.node_prefix + node.node_address + ':' + node.node_port;
        return new Promise((resolve, reject) => {
            this.database.run('INSERT INTO node (node_prefix, node_address, node_port, node_port_api, node_id, status) VALUES (?,?,?,?,?,?)', [
                node.node_prefix,
                node.node_address,
                node.node_port,
                node.node_port_api,
                node.node_id,
                node.status === undefined ? 1 : node.status
            ], (err) => {
                if (err) {
                    err.message.startsWith('SQLITE_CONSTRAINT') ? console.log(`[database] node ${url} already exits`) : console.error(err.message);
                    if (!node.node_id) {
                        return reject(err.message);
                    }
                    else {
                        const set          = _.pick(node, [
                            'status',
                            'node_prefix',
                            'node_address',
                            'node_port',
                            'node_api_port'
                        ]);
                        set['update_date'] = Math.floor(ntp.now().getTime() / 1000);
                        const {
                                  sql,
                                  parameters
                              }            = Database.buildUpdate('UPDATE node', set, {node_id: node.node_id});
                        this.database.run(sql, parameters, err => {
                            console.log(`[database] update node ${url} with id ${node.node_id}`);
                            return err ? reject() : resolve();
                        });
                        return;
                    }
                }
                resolve();
            });
        });
    }

    updateNode(node) {
        return new Promise(resolve => {
            const set          = _.pick(node, [
                'status',
                'node_prefix',
                'node_address',
                'node_port',
                'node_api_port'
            ]);
            set['update_date'] = Math.floor(ntp.now().getTime() / 1000);
            const {
                      sql,
                      parameters
                  }            = Database.buildUpdate('UPDATE node', set, {node_id: node.node_id});
            this.database.run(sql, parameters, () => {
                return resolve();
            });
        });
    }

    resetNodeState() {
        return new Promise(resolve => {
            this.database.run('UPDATE node SET status = 1', () => {
                return resolve();
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

    checkup() {
        return new Promise(resolve => {
            this.database.run('DELETE FROM node_attribute WHERE attribute_type_id NOT IN (SELECT attribute_type_id FROM node_attribute_type)', (err) => {
                if (err) {
                    console.log(err);
                }
                resolve();
            });
        });
    }
}
