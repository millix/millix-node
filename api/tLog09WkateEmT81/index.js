import Endpoint from '../endpoint';
import triggerEngine from '../../trigger/trigger';


/**
 * api update_trigger_action
 */


// Fields that canot be updated by the user
const unupdateableFields = ['id', 'trigger_id', 'last_action_message', 'last_action_date', 'create_date'];


class _tLog09WkateEmT81 extends Endpoint {
    constructor() {
        super('tLog09WkateEmT81');
    }

    /**
     * updates a trigger action
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
            triggerName = req.body.p0;
            triggerAction = req.body.p1;
        }

        try {
            if (!(triggerAction.name)) {
                console.log(`[api ${this.endpoint}] Missing trigger action name in the request`);
                return res.send({
                    status: 'fail',
                    message: 'trigger action name not sent'
                });
            }

            console.log(`[api ${this.endpoint}] Received request to update trigger action ${triggerAction.name} for trigger ${triggerName}. Checking if trigger exists`);

            if (!(triggerEngine.checkTriggerExists(triggerName))) {
                console.log(`[api ${this.endpoint}] Trigger ${triggerName} does not exist`);
                return res.send({
                    status : 'fail',
                    message: 'trigger does not exist'
                });
            }

            for (let field of unupdateableFields) {
                if (field in triggerAction) {
                    console.log(`[api ${this.endpoint}] Tried to update field ${field}. Rejecting`);
                    return res.send({
                        status: 'fail',
                        message: 'field cannot be updated',
                    });
                }
            }

            return triggerEngine.updateTriggerAction(triggerName, triggerAction)
                                .then(_ => {
                                    console.log(`[api ${this.endpoint}] Updated trigger action ${triggerAction.name}`);
                                    return res.send({
                                        status: 'success'
                                    });
                                })
                                .catch(err => {
                                    console.log(`[api ${this.endpoint}] Failed to update trigger action ${triggerAction.name}: ${err}`);
                                    return res.send({
                                        status : 'fail',
                                        message: `Failed to update trigger action: ${err}`
                                    });
                                });
        }
        catch (e) {
            console.log(`[api ${this.endpoint}] error: ${e}`);
            return res.send({
                status : 'fail',
                message: 'update_trigger_action_error'
            });
        }
    }
}


export default new _tLog09WkateEmT81();
