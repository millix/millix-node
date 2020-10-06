import Endpoint from '../endpoint';
import triggerEngine from '../../trigger/trigger';


/**
 * api invoke_trigger
 */

class _8s9Auqlc7RHbpxsJ extends Endpoint {
    constructor() {
        super('8s9Auqlc7RHbpxsJ');
    }

    /**
     * invokes a trigger using provided trigger name
     * @param app
     * @param req (p0: trigger_name<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        let triggerName;

        if (!req.body.p0) {
            return res.status(400).send({
                status : 'fail',
                message: 'p0<trigger_name> is required'
            });
        }
        else {
            triggerName = req.body.p0;

        }

        try {
            console.log(`[api ${this.endpoint}] Received request to invoke trigger ${triggerName}. Checking if the trigger exists`);

            if (!(triggerEngine.checkTriggerExists(triggerName))) {
                console.log(`[api ${this.endpoint}] Trigger ${triggerName} does not exist`);
                return res.send({
                    status : 'fail',
                    message: 'trigger does not exist'
                });
            }

            if (triggerEngine.isTriggerDisabled(triggerName)) {
                console.log(`[api ${this.endpoint}] Trigger ${triggerName} cannot be invoked as it is disabled`);
                return res.send({
                    status : 'fail',
                    message: 'trigger is disabled'
                });
            }

            return triggerEngine.invokeTrigger(triggerName)
                                .then(_ => {
                                    console.log(`[api ${this.endpoint}] Trigger ${triggerName} successfully invoked`);
                                    return res.send({
                                        status: 'success'
                                    });
                                })
                                .catch(err => {
                                    console.log(`[api ${this.endpoint}] Failed to invoke trigger ${triggerName}. Error: ${err}`);
                                    return res.send({
                                        status : 'fail',
                                        message: `Failed to remove trigger: ${err}`
                                    });
                                });
        }
        catch (e) {
            console.log(`[api ${this.endpoint}] Error while invoking trigger ${triggerName}: ${e}`);
            return res.send({
                status : 'fail',
                message: 'invoke_trigger_error'
            });
        }
    }
}


export default new _8s9Auqlc7RHbpxsJ();
