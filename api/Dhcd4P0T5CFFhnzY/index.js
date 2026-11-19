import Endpoint from '../endpoint';
import cloudNotice from '../../net/cloud-notice';
import config from '../../core/config/config';


/**
 * api list_cloud_notice
 */
class _Dhcd4P0T5CFFhnzY extends Endpoint {
    constructor() {
        super('Dhcd4P0T5CFFhnzY');
    }

    /**
     * returns the notices this node holds (status 1: anchored, 0: waiting
     * for its anchor) and, for a subject, how many reporting nodes count
     * against this node's threshold
     * @param app
     * @param req (p0: notice_type, p1: subject (certificate:<id> or
     *     domain:<domain>), p2: status)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const where = {};
        req.query.p0 && (where.notice_type = req.query.p0);
        req.query.p1 && (where.subject = req.query.p1);
        req.query.p2 !== undefined && (where.status = parseInt(req.query.p2));
        Promise.all([
            cloudNotice.listNotice(where),
            req.query.p1 ? cloudNotice.countReporters(req.query.p1) : Promise.resolve(undefined)
        ]).then(([noticeList, reporterCount]) => res.send({
            api_status    : 'success',
            threshold     : config.CLOUD_NOTICE_THRESHOLD,
            reporter_count: reporterCount,
            notice_list   : noticeList
        })).catch(e => res.send({
            api_status : 'fail',
            api_message: `${e?.error || e}`
        }));
    }
}


export default new _Dhcd4P0T5CFFhnzY();
