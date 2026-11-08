import Endpoint from '../endpoint';
import cloudOffer from '../../net/cloud-offer';


/**
 * api list_cloud_offer
 */
class _RDnFlREcZqyzH2XL extends Endpoint {
    constructor() {
        super('RDnFlREcZqyzH2XL');
        this.orderByList = [
            'create_date asc',
            'create_date desc',
            'end_date asc',
            'end_date desc',
            'publish_date asc',
            'publish_date desc'
        ];
    }

    /**
     * returns the verified tangled cloud offers known by the node that have
     * not ended. each offer carries its signature so the caller can verify it
     * again.
     * @param app
     * @param req (p0: service, p1: country (ISO 3166-1 alpha-2), p2:
     *     order_by="create_date desc", p3: record_limit=1000)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const service = req.query.p0;
        const country = req.query.p1 ? req.query.p1.toUpperCase() : undefined;
        const orderBy = req.query.p2 || 'create_date desc';
        const limit   = parseInt(req.query.p3) || 1000;

        if (!this.orderByList.includes(orderBy)) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: `p2<order_by> must be one of ${this.orderByList.join(', ')}`
            });
        }

        cloudOffer.listOffers({
            service,
            country
        }, orderBy, limit)
                  .then(offerList => res.send({
                      api_status: 'success',
                      offer_list: offerList
                  }))
                  .catch(e => res.send({
                      api_status : 'fail',
                      api_message: `unexpected generic api error: (${e})`
                  }));
    }
}


export default new _RDnFlREcZqyzH2XL();
