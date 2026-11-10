import Endpoint from '../endpoint';
import vpnClient from '../../net/vpn/vpn-client';


/**
 * api open_vpn_session
 */
class _CbAA35mNPELnmndw extends Endpoint {
    constructor() {
        super('CbAA35mNPELnmndw');
    }

    /**
     * opens a vpn session through the exit node of an offer and starts a
     * local https proxy on 127.0.0.1. with p3 pass_id it uses a broker pass
     * bought with buy_cloud_pass. otherwise it pays portion_count portions of
     * data into an escrow for the exit node; what is not earned by the exit
     * node returns to this wallet after unlock_after seconds.
     * @param app
     * @param req (p0: offer_id<required>, p1: portion_count<required without
     *     p3>, p2: unlock_after=86400, p3: pass_id)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const offerID      = req.query.p0;
        if (offerID && req.query.p3) {
            return vpnClient.openPassSession(offerID, req.query.p3)
                            .then(session => res.send({
                                api_status: 'success',
                                session
                            }))
                            .catch(e => res.send({
                                api_status : 'fail',
                                api_message: `${e?.error || e}`
                            }));
        }
        const portionCount = parseInt(req.query.p1);
        const unlockAfter  = req.query.p2 !== undefined ? parseInt(req.query.p2) : 86400;
        if (!offerID || !(portionCount > 0) || !(unlockAfter > 0)) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<offer_id> and a positive p1<portion_count> are required, p2<unlock_after> must be positive'
            });
        }

        vpnClient.openSession(offerID, portionCount, unlockAfter)
                 .then(session => res.send({
                     api_status: 'success',
                     session
                 }))
                 .catch(e => res.send({
                     api_status : 'fail',
                     api_message: `${e?.error || e}`
                 }));
    }
}


export default new _CbAA35mNPELnmndw();
