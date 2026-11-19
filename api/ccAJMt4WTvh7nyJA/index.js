import Endpoint from '../endpoint';
import broker from '../../net/broker/broker';


/**
 * api update_cloud_broker_trial_block
 */
class _ccAJMt4WTvh7nyJA extends Endpoint {
    constructor() {
        super('ccAJMt4WTvh7nyJA');
    }

    /**
     * broker: sets the exit nodes the free trial does not extend to. they
     * refuse this broker's trial certificates once they ask the broker, and
     * while they are on the list the broker holds back what their trial
     * receipts earn (paid if they are taken off the list). their pass
     * receipts are paid as before.
     * @param app
     * @param req (p0: node_id_list<required> (json): the whole list, [] to
     *     empty it)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        let nodeIDList;
        try {
            nodeIDList = JSON.parse(req.query.p0);
        }
        catch (e) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<node_id_list> must be a json list of node ids'
            });
        }

        broker.setTrialBlockList(nodeIDList)
              .then(trialBlockList => res.send({
                  api_status      : 'success',
                  trial_block_list: trialBlockList
              }))
              .catch(e => res.send({
                  api_status : 'fail',
                  api_message: `${e?.error || e}`
              }));
    }
}


export default new _ccAJMt4WTvh7nyJA();
