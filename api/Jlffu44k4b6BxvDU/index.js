import Endpoint from '../endpoint';
import cloudStorage from '../../net/cloud-storage';


/**
 * api add_cloud_storage_receipt
 */
class _Jlffu44k4b6BxvDU extends Endpoint {
    constructor() {
        super('Jlffu44k4b6BxvDU');
    }

    /**
     * host: takes a storage receipt signed by a renter. the first receipt of
     * an escrow records the escrow, once its funding has reached this node
     * (until then it fails with escrow_not_funded and can be sent again),
     * and ties it to the receipt's copy. the node checks that the escrow
     * pays this node, is funded and that the receipt is signed, newer and
     * for the same copy. it does not know the copy's size: whether the
     * portion_amount it returns is the host's price is for the storage
     * service to check. a receipt that is not newer than the one the node
     * holds fails with receipt_not_newer and changes nothing. the escrow is
     * claimed with the latest receipt (claim_escrow, and by the node itself
     * before the unlock date).
     * @param app
     * @param req (p0: terms<required> (json, the escrow terms), p1:
     *     receipt<required> (json), p2: receipt_signature<required>, p3:
     *     funding_transaction_id)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const {
                  p0: termsJSON,
                  p1: receiptJSON,
                  p2: receiptSignature,
                  p3: fundingTransactionID
              } = req.query;
        if (!termsJSON || !receiptJSON || !receiptSignature) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<terms>, p1<receipt> and p2<receipt_signature> are required'
            });
        }

        let terms, receipt;
        try {
            terms   = JSON.parse(termsJSON);
            receipt = JSON.parse(receiptJSON);
        }
        catch (e) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<terms> and p1<receipt> must be valid json'
            });
        }

        cloudStorage.addReceipt(terms, receipt, receiptSignature, fundingTransactionID)
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


export default new _Jlffu44k4b6BxvDU();
