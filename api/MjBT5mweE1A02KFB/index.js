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
     *
     * a storage_host offer needs p6, the terms of the storage service, which
     * is not part of the node: service_port (the port the storage service
     * listens on), price_gb_hour (millix for a GB of 1,000,000,000 bytes
     * kept an hour, integer above 0), price_fetch_gb (millix for a GB
     * fetched, integer, 0 for free), address (the wallet address to pay),
     * free_gb (whole GB still on offer, integer), accept_new (true or
     * false: whether the host takes new files) and rental_period_min (the
     * shortest rental in seconds, integer above 0). in the signed offer
     * service_port is in endpoint and the others in storage.
     * @param app
     * @param req (p0: service<required>, p1: country<required> (ISO 3166-1
     *     alpha-2), p2: upload_speed_kbps<required>, p3:
     *     broker_list<required> (json array of {address, public_key}), p4:
     *     end_date<required> (unix time in seconds), p5: city, p6:
     *     storage<required for storage_host> (json object {service_port,
     *     price_gb_hour, price_fetch_gb, address, free_gb, accept_new,
     *     rental_period_min}))
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
                  p5: city,
                  p6: storageJSON
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

        let storage;
        if (storageJSON !== undefined) {
            try {
                storage = JSON.parse(storageJSON);
            }
            catch (e) {
                return res.status(400).send({
                    api_status : 'fail',
                    api_message: 'p6<storage> is not valid json'
                });
            }
        }

        if ((service === 'storage_host') !== (storage !== undefined)) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p6<storage> is required for the service storage_host, and only for it'
            });
        }

        cloudOffer.publishOffer(service, {
            country: country.toUpperCase(),
            city
        }, Number(uploadSpeedKbps), brokerList, Number(endDate), storage)
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
