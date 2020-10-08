import Endpoint from '../endpoint';
import triggerEngine from '../../trigger/trigger';
import {validateTrigger, validateTriggerAction} from '../../trigger/validation';


/**
 * api add_trigger
 */

class _Hehn7N0KBVvuFQHf extends Endpoint {
    constructor() {
        super('Hehn7N0KBVvuFQHf');
    }

    /**
     * accepts a trigger and trigger actions payload to store a trigger and
     * corresponding trigger actions to the database
     * @param app
     * @param req (p0: trigger<required>, p1: trigger_actions<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        let trigger;
        let triggerActions;


        if (!req.body.p0 || !req.body.p1) {
            return res.status(400).send({
                status : 'fail',
                message: 'p0<trigger> and p1<trigger_actions> are required'
            });
        }
        else {
            trigger        = req.body.p0;
            triggerActions = req.body.p1;
        }

        try {
            console.log(`[api ${this.endpoint}] Received request to add new trigger ${trigger.name}. Validating`);

            if (trigger.name === undefined) {
                console.log(`[api ${this.endpoint} Missing trigger name`);
                return res.send({
                    status: 'failure',
                    message: 'Missing trigger name',
                });
            }

            if (triggerEngine.checkTriggerExists(trigger.name)) {
                console.log(`[api ${this.endpoint}] Trigger ${trigger.name} already exists`);
                return res.send({
                    status: 'failure',
                    message: 'Trigger already exists'
                });
            }

            try {
                validateTrigger(trigger);
            } catch(err) {
                console.log(`[api ${this.endpoint} Invalid trigger. Error: ${err}`);
                return res.send({
                    status: 'failure',
                    message: `Invalid trigger: ${err}`,
                });
            }

            for (let triggerAction of triggerActions) {
                try {
                    validateTriggerAction(triggerAction);
                } catch(err) {
                    console.log(`[api ${this.endpoint}] Invalid trigger action ${triggerAction.name}. Error: ${err}`);
                    return res.send({
                        status: 'failure',
                        message: `Invalid trigger action ${triggerAction.name}: ${err}`
                    });
                }
            }

            console.log(`[api ${this.endpoint}] Validated trigger and trigger actions`);

            return triggerEngine.addTrigger(trigger, triggerActions)
                                .then(_ => {
                                    console.log(`[api ${this.endpoint}] Trigger added. Returning success`);
                                    return res.send({
                                        status: 'success'
                                    });
                                })
                                .catch(err => {
                                    console.log(`[api ${this.endpoint}] Error while adding trigger: ${err}`);
                                    return res.send({
                                        status : 'fail',
                                        message: `Failed to add trigger: ${err}`
                                    });
                                });
        }
        catch (e) {
            console.log(`[api ${this.endpoint}] error: ${e}`);
            return res.send({
                status : 'fail',
                message: 'add_trigger_error'
            });
        }
    }
}


export default new _Hehn7N0KBVvuFQHf();
