import Endpoint from '../endpoint';
import cloudStorage from '../../net/cloud-storage';


/**
 * api sign_cloud_storage_receipt
 */
class _FsiAYlpbIWdpHTTc extends Endpoint {
    constructor() {
        super('FsiAYlpbIWdpHTTc');
    }

    /**
     * renter: signs the next receipt of a storage escrow after a proof, for
     * the storage service to send to the host. a passed proof earns the host
     * the proof intervals that ended since the proof before it; a missed
     * proof earns nothing and its receipt only moves the period on. a second
     * proof in the same proof interval fails with storage_receipt_not_due.
     * @param app
     * @param req (p0: escrow_address_base<required>, p1:
     *     proof_passed<required> (true or false))
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const {
                  p0: addressBase,
                  p1: proofPassed
              } = req.query;
        if (!addressBase || ![
            'true',
            'false'
        ].includes(proofPassed)) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<escrow_address_base> and p1<proof_passed> (true or false) are required'
            });
        }

        cloudStorage.signReceipt(addressBase, proofPassed === 'true')
                    .then(result => res.send({
                        api_status: 'success',
                        ...result
                    }))
                    .catch(e => res.send({
                        api_status : 'fail',
                        api_message: `${e}`
                    }));
    }
}


export default new _FsiAYlpbIWdpHTTc();
