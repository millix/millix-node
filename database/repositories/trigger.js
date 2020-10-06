import {Database} from '../database';
import console from '../../core/console';
import _ from 'lodash';
import ntp from '../../core/ntp';


export default class Trigger {
    constructor(database) {
        this.database = database;
    }

    addTrigger(trigger) {
        return new Promise((resolve, reject) => {
            this.database.run('INSERT INTO trigger (trigger_name, trigger_type, object_guid, object_key, shard_id, data_source, data_source_type, data_source_variable, variable_1, variable_2, variable_operator, allow_adhoc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
                trigger.name,
                trigger.type,
                trigger.object_guid,
                trigger.object_key,
                trigger.shard_id,
                trigger.data_source,
                trigger.data_source_type,
                trigger.data_source_variable,
                trigger.variable_1,
                trigger.variable_2,
                trigger.variable_operator,
                trigger.allow_adhoc
            ], (err) => {
                if (err) {
                    return reject(err.message);
                }
                else {
                    console.log(`[database] Inserted trigger ${trigger.name} of type ${trigger.type}`);
                    resolve();
                }
            })
        })
    }

    addTriggerWithActions(trigger, actions) {
        return new Promise((resolve, reject) => {
            this.database.run('BEGIN TRANSACTION', err => {
                if (err) {
                    return reject(err.message);
                }

                this.database.run('INSERT INTO trigger (trigger_name, trigger_type, object_guid, object_key, shard_id, data_source, data_source_type, data_source_variable, variable_1, variable_2, variable_operator, allow_adhoc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?); SELECT last_insert_rowid', [
                    trigger.name,
                    trigger.type,
                    trigger.object_guid,
                    trigger.object_key,
                    trigger.shard_id,
                    trigger.data_source,
                    trigger.data_source_type,
                    trigger.data_source_variable,
                    trigger.variable_1,
                    trigger.variable_2,
                    trigger.variable_operator,
                    trigger.allow_adhoc
                ], (err) => {
                    if (err) {
                        return reject(err.message);
                    }

                    console.log(`[database] Inserted trigger ${trigger.name} of type ${trigger.type}`);

                    for (let action of Actions) {
                        this.addAction(this.lastId, action)
                            .catch(err => {
                                return reject(err.message);
                            })
                    }

                    console.log(`[database] Inserted ${actions.length} trigger actions`);

                    this.database.run('COMMIT', (err) => {
                        if (err) {
                            return reject(err.message);
                        } else  {
                            console.log(`[database] Successfully commited database transaction`);
                            resolve(this.lastId);
                        }
                    });
                });
            });
        });
    }

    getTrigger(where) {
        return new Promise((resolve, reject) => {
            let {sql, parameters} = Database.buildQuery('SELECT * FROM trigger', where);
            this.database.get(sql, parameters, (err, row) => {
                if (err) {
                    return reject(err.message);
                } else {
                    resolve(row);
                }
            })
        })
    }

    getTriggerId(triggerName) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT id FROM trigger WHERE trigger_name = ?', [triggerName], (err, row) => {
                if (err) {
                    return reject(err.message);
                } else {
                    if (row === undefined) {
                        resolve(null);
                    } else {
                        resolve(row.id);
                    }
                }
            })
        })
    }

    getAllTriggers() {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT * FROM trigger', [], (err, rows) => {
                if (err) {
                    reject(err.message);
                }
                else {
                    resolve(rows);
                }
            })
        })
    }

    updateTrigger(triggerID, trigger) {
        return new Promise((resolve, reject) => {
            let set = _.pick(trigger, [
                'name',
                'type',
                'object_guid',
                'object_key',
                'shard_id',
                'data_source',
                'data_source_type',
                'data_source_variable',
                'variable_1',
                'variable_2',
                'variable_operator',
                'allow_adhoc',
                'status',
            ]);
            set['update_date']      = Math.floor(ntp.now().getTime() / 1000);
            const { sql, parameters } = Database.buildUpdate('UPDATE trigger', set, {id: triggerID});
            this.database.run(sql, parameters,  (err) => {
                if (err) {
                    reject(err.message);
                } else {
                    console.log(`[database] Updated trigger with id ${triggerID}`);
                    resolve();
                }
            })
        })
    }

    updateTriggerAction(triggerID, triggerAction) {
        return new Promise((resolve, reject) => {
            let set = _.pick(triggerAction, [
                'name',
                'trigger_result',
                'action',
                'action_variable',
                'priority',
                'status',
            ]);
            set['update_date']      = Math.floor(ntp.now().getTime() / 1000);
            const { sql, parameters } = Database.buildUpdate('UPDATE trigger_action', set, {trigger_id: triggerID, name: triggerAction.name});
            this.database.run(sql, parameters,  (err) => {
                if (err) {
                    reject(err.message);
                } else {
                    console.log(`[database] Updated trigger action ${triggerAction.name}`);
                    resolve();
                }
            })
        })
    }

    setLastTriggerStatus(triggerID, status) {
        return new Promise((resolve, reject) => {
            this.database.run(`UPDATE trigger SET last_trigger_state = ?, update_date = ? WHERE id = ?`, [status, Math.floor(ntp.now().getTime() / 1000), triggerID], (err) => {
                if (err) {
                    reject(err.message);
                } else {
                    console.log(`[database] Set trigger ${triggerID} last status to ${status}`);
                    resolve();
                }
            })
        })
    }

    setTriggerActionResult(triggerActionID, result, timestamp) {
        return new Promise((resolve, reject) => {
            this.database.run('UPDATE trigger_action SET last_action_message = ?, last_action_date = ?, update_date = ? WHERE id = ?', [result, timestamp, timestamp, triggerActionID], (err) => {
                if (err) {
                    reject(err.message);
                }
            })
        })
    }

    checkTriggerExists(triggerName) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT id FROM trigger WHERE trigger_name = ?', [triggerName], (err, row) => {
                if (err) {
                    reject(err.message);
                } else {
                    resolve(row !== undefined);
                }
            })
        })
    }

    checkTriggerActionExists(triggerName, action) {
        return new Promise((resolve, reject) => {
            this.database.get('SELECT trigger_action.id FROM trigger_action INNER JOIN trigger ON trigger_action.trigger_id = trigger.id WHERE trigger.name = ? AND trigger_action.action = ?', [triggerName, action], (err, row) => {
                if (err) {
                    reject(err.message);
                } else {
                    resolve(row !== undefined);
                }
            })
        })
    }

    removeTrigger(triggerName) {
        return new Promise((resolve, reject) => {
            this.database.run('DELETE FROM trigger WHERE trigger_name = ?', [triggerName], (err) => {
                if (err) {
                    return reject(err.message);
                }
                else {
                    console.log(`[database] Removed trigger ${triggerName}`);
                    resolve();
                }
            })
        })
    }

    removeTriggerAction(triggerID, actionName) {
        return new Promise((resolve, reject) => {
            this.database.run('DELETE FROM trigger_action WHERE trigger_id = ? AND name = ?', [triggerID, actionName], (err) => {
                if (err) {
                    return reject(err.message);
                } else {
                    console.log(`[database] Removed trigger action`);
                    resolve();
                }
            })
        })
    }

    addAction(triggerID, triggerAction) {
        return new Promise((resolve, reject) => {
            this.database.run('INSERT INTO trigger_action (trigger_id, name, trigger_result, action, action_variable, priority) VALUES (?, ?, ?, ?, ?, ?)', [
                triggerID,
                triggerAction.name,
                triggerAction.trigger_result,
                triggerAction.action,
                triggerAction.action_variable,
                triggerAction.priority

            ], (err) => {
                if (err) {
                    return reject(err.message);
                }
                else {
                    console.log(`[database] Inserted trigger action ${triggerAction.name} for trigger ID ${triggerID}`);
                    resolve();
                }
            })
        })
    }

    getActions(trigger_id) {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT * FROM trigger_action WHERE trigger_id = ?', [trigger_id], (err, rows) => {
                if (err) {
                    return reject(err.message);
                }
                else {
                    resolve(rows);
                }
            })
        })
    }

    getAllActions() {
        return new Promise((resolve, reject) => {
            this.database.all('SELECT * FROM trigger_action', [], (err, rows) => {
                if (err) {
                    return reject(err.message);
                } else {
                    resolve(rows);
                }
            })
        })
    }
}
