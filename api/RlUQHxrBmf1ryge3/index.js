import Endpoint from '../endpoint';
import triggerEngine from '../../trigger/trigger';


/**
 * api remove_trigger_action
 */

class _RlUQHxrBmf1ryge3 extends Endpoint {
    constructor() {
        super('RlUQHxrBmf1ryge3');
    }

    /**
     * removes a trigger action using provided trigger name and action
     * @param app
     * @param req (p0: trigger_name<required>,  p1<trigger_action_name>required)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        let triggerName;
        let actionName;

        if (!req.body.p0 || !req.body.p1) {
            return res.status(400).send({
                status : 'fail',
                message: 'p0<trigger_name> and p1<trigger_action_name> are required'
            });
        }
        else {
            triggerName = req.body.p0;
            actionName = req.body.p1;
        }

        try {
            console.log(`[api ${this.endpoint}] Received request to remove trigger action ${actionName} for trigger ${triggerName}. Checking if trigger exists`);

            if (!(triggerEngine.checkTriggerExists(triggerName))) {
                console.log(`[api ${this.endpoint}] Trigger ${triggerName} does not exist`);
                return res.send({
                    status : 'fail',
                    message: 'trigger does not exist'
                });
            }

            if (!(triggerEngine.checkActionExists(triggerName, actionName))) {
                console.log(`[api ${this.endpoint}] Trigger action ${actionName} does not exist`);
                return res.send({
                    status : 'fail',
                    message: 'trigger action does not exist'
                });
            }

            return triggerEngine.removeTriggerAction(triggerName, actionName)
                                .then(_ => {
                                    console.log(`[api ${this.endpoint}] Trigger action ${actionName} removed for trigger ${triggerName}. Returning success`);
                                    return res.send({
                                        status: 'success'
                                    });
                                })
                                .catch(err => {
                                    console.log(`[api ${this.endpoint}] Failed to remove trigger action ${actionName} for trigger ${triggerName}. Error: ${err}`);
                                    return res.send({
                                        status : 'fail',
                                        message: `Failed to remove trigger action: ${err}`
                                    });
                                });
        }
        catch (e) {
            console.log(`[api ${this.endpoint}] error: ${e}`);
            return res.send({
                status : 'fail',
                message: 'remove_trigger_action_error'
            });
        }
    }
}


export default new _RlUQHxrBmf1ryge3();
