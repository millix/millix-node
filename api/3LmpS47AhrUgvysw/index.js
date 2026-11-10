import Endpoint from '../endpoint';
import database from '../../database/database';
import walletEscrow from '../../core/wallet/wallet-escrow';


/**
 * api list_escrow
 */
class _3LmpS47AhrUgvysw extends Endpoint {
    constructor() {
        super('3LmpS47AhrUgvysw');
    }

    /**
     * returns the escrows this node pays into or is paid from, with the
     * amount still locked, the amount released, the latest receipt and what
     * can be claimed
     * @param app
     * @param req (p0: escrow_address_base, p1: role (payer, payee))
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        const addressBase = req.query.p0;
        const role        = req.query.p1;
        (addressBase ? Promise.resolve([{address_base: addressBase}]) : database.getRepository('escrow').listEscrow({role}, 'create_date desc', 1000))
            .then(escrowList => Promise.all(escrowList.map(escrowRecord => walletEscrow.getEscrowStatus(escrowRecord.address_base))))
            .then(escrowList => res.send({
                api_status : 'success',
                escrow_list: escrowList
            }))
            .catch(e => res.send({
                api_status : 'fail',
                api_message: `${e}`
            }));
    }
}


export default new _3LmpS47AhrUgvysw();
