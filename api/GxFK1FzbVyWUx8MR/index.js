import Endpoint from '../endpoint';
import triggerEngine from '../../trigger/trigger';
import {validateTriggerAction} from '../../trigger/validation';


/**
 * api add_trigger_action
 */

class _GxFK1FzbVyWUx8MR extends Endpoint {
    constructor() {
        super('GxFK1FzbVyWUx8MR');
    }

    /**
     * Adds a trigger action for an existing trigger
     * @param app
     * @param req (p0: trigger_name<required>, p1: trigger_action<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        let triggerName;
        let triggerAction;

        if (!req.body.p0 || !req.body.p1) {
            return res.status(400).send({
                status : 'fail',
                message: 'p0<trigger_name> and p1<trigger_action> are required'
            });
        }
        else {
            triggerName   = req.body.p0;
            triggerAction = req.body.p1;
        }

        try {
            console.log(`[api ${this.endpoint}] Received request to add triger action ${triggerAction.name} to trigger ${triggerName}. Validating trigger action`);

            try {
                validateTriggerAction(triggerAction);
            } catch(err) {
                console.log(`[api ${this.endpoint}] Trigger action is invalid`);
                return res.send({
                    status : 'fail',
                    message: 'trigger action is invalid'
                });
            }

            console.log(`[api ${this.endpoint}] Checking if the trigger exists`);

            if (!(triggerEngine.checkTriggerExists(triggerName))) {
                console.log(`[api ${this.endpoint}] Trigger ${triggerName} does not exist`);
                return res.send({
                    status : 'fail',
                    message: 'trigger does not exist'
                });
            }

            console.log(`[api ${this.endpoint}] Checking if trigger action ${triggerAction.name} exists`);
            if (triggerEngine.checkActionExists(triggerName, triggerAction.name)) {
                console.log(`[api ${this.endpoint}] Trigger action ${triggerAction.name} already exists`);
                return res.send({
                    status : 'fail',
                    message: 'trigger action already exists'
                });
            }

            return triggerEngine.addTriggerAction(triggerName, triggerAction)
                                .then(_ => {
                                    console.log(`[api ${this.endpoint}] Trigger action ${triggerAction.name} added. Returning success`);
                                    return res.send({
                                        status: 'success'
                                    });
                                })
                                .catch(err => {
                                    console.log(`[api ${this.endpoint}] Error while adding trigger action ${triggerAction.name}: ${err}`);
                                    return res.send({
                                        status : 'failure',
                                        message: `Failed to add action: ${err}`
                                    });
                                });
        }
        catch (e) {
            console.log(`[api ${this.endpoint}] Error while adding trigger action: ${e}`);
            return res.send({
                status : 'fail',
                message: 'add_trigger_action_error'
            });
        }
    }
}


export default new _GxFK1FzbVyWUx8MR();
