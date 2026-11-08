import Endpoint from '../endpoint';
import cloudOffer from '../../net/cloud-offer';
import config from '../../core/config/config';


/**
 * api publish_cloud_offer
 */
class _MjBT5mweE1A02KFB extends Endpoint {
    constructor() {
        super('MjBT5mweE1A02KFB');
    }

    /**
     * signs this node's offer for a tangled cloud service and sends it to
     * its peers. it replaces the node's previous offer for the same service.
     * publishing does not create a transaction.
     * @param app
     * @param req (p0: service<required>, p1: country<required> (ISO 3166-1
     *     alpha-2), p2: upload_speed_kbps<required>, p3:
     *     broker_list<required> (json array of {address, public_key}), p4:
     *     end_date<required> (unix time in seconds), p5: city)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const {
                  p0: service,
                  p1: country,
                  p2: uploadSpeedKbps,
                  p3: brokerListJSON,
                  p4: endDate,
                  p5: city
              } = req.query;
        if (!service || !country || !uploadSpeedKbps || !brokerListJSON || !endDate) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<service>, p1<country>, p2<upload_speed_kbps>, p3<broker_list> and p4<end_date> are required'
            });
        }

        if (!config.CLOUD_OFFER_SERVICE_LIST.includes(service)) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: `p0<service> must be one of ${config.CLOUD_OFFER_SERVICE_LIST.join(', ')}`
            });
        }

        let brokerList;
        try {
            brokerList = JSON.parse(brokerListJSON);
        }
        catch (e) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p3<broker_list> is not valid json'
            });
        }

        if (!Array.isArray(brokerList) || brokerList.length === 0) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p3<broker_list> must be a non empty array of {address, public_key}'
            });
        }

        cloudOffer.publishOffer(service, {
            country: country.toUpperCase(),
            city
        }, Number(uploadSpeedKbps), brokerList, Number(endDate))
                  .then(offer => res.send({
                      api_status: 'success',
                      offer
                  }))
                  .catch(e => res.send({
                      api_status : 'fail',
                      api_message: `${e}`
                  }));
    }
}


export default new _MjBT5mweE1A02KFB();
