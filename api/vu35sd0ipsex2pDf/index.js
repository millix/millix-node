import Endpoint from '../endpoint';
import triggerEngine from '../../trigger/trigger';


/**
 * api remove_trigger
 */

class _vu35sd0ipsex2pDf extends Endpoint {
    constructor() {
        super('vu35sd0ipsex2pDf');
    }

    /**
     * removes a trigger using provided trigger name
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
            console.log(`[api ${this.endpoint}] Received request to remove trigger ${triggerName}. Checking if trigger exists`);

            if (!(triggerEngine.checkTriggerExists(triggerName))) {
                console.log(`[api ${this.endpoint}] Trigger ${triggerName} does not exist`);
                return res.send({
                    status : 'fail',
                    message: 'trigger does not exist'
                });
            }

            return triggerEngine.removeTrigger(triggerName)
                                .then(_ => {
                                    console.log(`[api ${this.endpoint}] Removed trigger ${triggerName}. Sending success`);
                                    return res.send({
                                        status: 'success'
                                    });
                                })
                                .catch(err => {
                                    console.log(`[api ${this.endpoint}] Failed to remove trigger ${triggerName}: ${err}`);
                                    return res.send({
                                        status : 'fail',
                                        message: `Failed to remove trigger: ${err}`
                                    });
                                });
        }
        catch (e) {
            console.log(`[api ${this.endpoint}] error: ${e}`);
            return res.send({
                status : 'fail',
                message: 'remove_trigger_error'
            });
        }
    }
}


export default new _vu35sd0ipsex2pDf();
