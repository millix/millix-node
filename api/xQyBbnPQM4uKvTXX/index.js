import Endpoint from '../endpoint';
import cloudNotice from '../../net/cloud-notice';
import database from '../../database/database';


/**
 * api publish_cloud_notice
 */
class _xQyBbnPQM4uKvTXX extends Endpoint {
    constructor() {
        super('xQyBbnPQM4uKvTXX');
    }

    /**
     * signs a notice with the node key, anchors it with a transaction of
     * this wallet (one transaction fee) and sends it to all peers once the
     * anchor is stable. a domain notice names a domain and a threat type. a
     * user notice names a prepaid certificate this exit node carried, a
     * pattern and its numbers, with the certificate's latest receipt at this
     * node as proof; it never names sites.
     * @param app
     * @param req (p0: notice_type<required> (domain or user), domain: p1:
     *     domain<required>, p2: threat_type<required>, p3: duration
     *     seconds; user: p1: certificate_id<required>, p2: pattern<required>,
     *     p3: numbers<required> (json), p4: duration seconds)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const {
                  p0: noticeType,
                  p1,
                  p2,
                  p3,
                  p4
              }   = req.query;
        let publish;
        if (noticeType === 'domain' && p1 && p2) {
            publish = cloudNotice.publishDomainNotice(p1, p2, p3 ? parseInt(p3) : undefined);
        }
        else if (noticeType === 'user' && p1 && p2 && p3) {
            let numbers;
            try {
                numbers = JSON.parse(p3);
            }
            catch (e) {
                return res.status(400).send({
                    api_status : 'fail',
                    api_message: 'p3<numbers> is not valid json'
                });
            }
            publish = database.getRepository('cloud_pass')
                              .getVPNCertificate(p1)
                              .then(record => {
                                  if (!record || !record.receipt) {
                                      return Promise.reject('certificate_receipt_not_found');
                                  }
                                  return cloudNotice.publishUserNotice(record.certificate, p2, numbers, record.receipt, record.receipt_signature, p4 ? parseInt(p4) : undefined);
                              });
        }
        else {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<notice_type> must be domain (p1<domain>, p2<threat_type>) or user (p1<certificate_id>, p2<pattern>, p3<numbers>)'
            });
        }

        publish.then(notice => res.send({
            api_status: 'success',
            notice
        })).catch(e => res.send({
            api_status : 'fail',
            api_message: `${e?.error || e}`
        }));
    }
}


export default new _xQyBbnPQM4uKvTXX();
