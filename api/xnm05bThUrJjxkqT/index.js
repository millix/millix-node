import Endpoint from '../endpoint';
import triggerEngine from '../../trigger/trigger';


/**
 * api update_trigger
 */


// Fields that canot be updated by the user
const unupdateableFields = ['id', 'last_trigger_state', 'create_date'];


class _xnm05bThUrJjxkqT extends Endpoint {
    constructor() {
        super('xnm05bThUrJjxkqT');
    }

    /**
     * updates a trigger
     * @param app
     * @param req (p0: trigger<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        let trigger;

        if (!req.body.p0) {
            return res.status(400).send({
                status : 'fail',
                message: 'p0<trigger> is required'
            });
        }
        else {
            trigger = req.body.p0;
        }

        try {
            console.log(`[api ${this.endpoint}] Received request to update trigger ${trigger.name}. Checking if trigger exists`);

            if (!(trigger.name)) {
                console.log(`[api ${this.endpoint}] Name not sent. Cannot proceed with update`);
                return res.send({
                    status : 'fail',
                    message: 'missing trigger name'
                });
            }

            if (!(triggerEngine.checkTriggerExists(trigger.name))) {
                console.log(`[api ${this.endpoint}] Trigger ${trigger.name} does not exist`);
                return res.send({
                    status : 'fail',
                    message: 'trigger does not exist'
                });
            }

            for (let field of unupdateableFields) {
                if (field in trigger) {
                    console.log(`[api ${this.endpoint}] Tried to update field ${field} of trigger ${trigger.name}. Rejecting`);
                    return res.send({
                        status: 'fail',
                        message: 'field cannot be updated',
                    });
                }
            }

            return triggerEngine.updateTrigger(trigger.name, trigger)
                                .then(_ => {
                                    console.log(`[api ${this.endpoint}] Updated trigger ${trigger.name}. Sending success`);
                                    return res.send({
                                        status: 'success'
                                    });
                                })
                                .catch(err => {
                                    console.log(`[api ${this.endpoint}] Failed to update trigger ${trigger.name}: ${err}`);
                                    return res.send({
                                        status : 'fail',
                                        message: `Failed to update trigger: ${err}`
                                    });
                                });
        }
        catch (e) {
            console.log(`[api ${this.endpoint}] error: ${e}`);
            return res.send({
                status : 'fail',
                message: 'update_trigger_error'
            });
        }
    }
}


export default new _xnm05bThUrJjxkqT();
