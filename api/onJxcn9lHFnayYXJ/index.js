import Endpoint from '../endpoint';
import cloudStorage from '../../net/cloud-storage';


/**
 * api open_cloud_storage_escrow
 */
class _onJxcn9lHFnayYXJ extends Endpoint {
    constructor() {
        super('onJxcn9lHFnayYXJ');
    }

    /**
     * renter: locks the rent of one rental period of a file copy in an
     * escrow for the host of a storage_host offer. the rent is the offer's
     * price_gb_hour for the copy's size, a whole number of millix for each
     * proof interval of the period. the host earns it by receipts signed
     * after passed proofs (sign_cloud_storage_receipt); what it did not earn
     * returns to this wallet after the escrow's unlock date. the terms, the
     * funding transaction and the first receipt it returns are for the
     * host (add_cloud_storage_receipt).
     * @param app
     * @param req (p0: offer_id<required>, p1: copy_id<required> (32 hex
     *     characters), p2: size_bytes<required>, p3: period<required>
     *     (seconds))
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const {
                  p0: offerID,
                  p1: copyID,
                  p2: sizeBytes,
                  p3: period
              } = req.query;
        if (!offerID || !copyID || !(Number(sizeBytes) > 0) || !(Number(period) > 0)) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<offer_id>, p1<copy_id>, a positive p2<size_bytes> and a positive p3<period> are required'
            });
        }

        cloudStorage.openRental(offerID, copyID, Number(sizeBytes), Number(period))
                    .then(rental => res.send({
                        api_status: 'success',
                        ...rental
                    }))
                    .catch(e => res.send({
                        api_status : 'fail',
                        api_message: `${e?.error || e}`
                    }));
    }
}


export default new _onJxcn9lHFnayYXJ();
