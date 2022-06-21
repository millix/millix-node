import Endpoint from '../endpoint';
import dns from 'dns';
import config from '../../core/config/config';
import {promisify} from 'util';
import _ from 'lodash';


/**
 * api verify_dns_has_address_key_identifier
 */
class _DjwvDZ4bGUzKxOHW extends Endpoint {
    constructor() {
        super('DjwvDZ4bGUzKxOHW');
        dns.setServers(config.NODE_DNS_SERVER);
        this.resolveTxt = promisify(dns.resolveTxt);
    }

    /**
     * check if the address key identifier is configure in the dns tx record
     * @param app
     * @param req (p0: dns<required>, p1:address_key_identifier<required>)
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        if (!req.query.p0 || !req.query.p1) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<dns> and p1<address_key_identifier> are required'
            });
        }
        const dns                  = req.query.p0;
        const addressKeyIdentifier = req.query.p1;

        this.resolveTxt(dns)
            .then(txtRecords => {
                const addressKeyIdentifierSet = new Set();
                _.flatten(txtRecords).forEach(txtRecord => {
                    if (txtRecord.startsWith('tangled=')) {
                        txtRecord.substring(8).split(',').forEach(address => addressKeyIdentifierSet.add(address));
                    }
                });
                res.send({
                    is_address_verified: addressKeyIdentifierSet.has(addressKeyIdentifier)
                });
            })
            .catch(e => {
                return res.status(200).send({
                    api_status : 'fail',
                    api_message: `unexpected generic api error: (${e})`
                });
            });
    }
}


export default new _DjwvDZ4bGUzKxOHW();
