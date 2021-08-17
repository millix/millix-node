import database from '../../database/database';
import Endpoint from '../endpoint';


/**
 * api list_config_public
 */
class _hXwPQrVhLEALFsIJ extends Endpoint {
    constructor() {
        super('hXwPQrVhLEALFsIJ');
        this.publicConfigNameList = new Set([
            'NODE_PORT',
            'NODE_PORT_API',
            'NODE_INITIAL_LIST',
            'WALLET_TRANSACTION_DEFAULT_VERSION',
            'WALLET_TRANSACTION_REFRESH_VERSION',
            'WALLET_TRANSACTION_SUPPORTED_VERSION',
            'MILLIX_CIRCULATION',
            'NODE_MILLIX_VERSION',
            'PEER_ROTATION_CONFIG'
        ]);
    }

    /**
     * returns returns public config values
     * @param app
     * @param req (p0: type, p1: status, p2: order_by="create_date desc", p3:
     *     record_limit=1000)
     * @param res
     */
    handler(app, req, res) {
        const orderBy                 = req.query.p2 || 'create_date desc';
        const limit                   = parseInt(req.query.p3) || 1000;
        const configurationRepository = database.getRepository('config');
        configurationRepository.list({
            type  : req.query.p0,
            status: req.query.p1
        }, orderBy, limit)
                               .then(configurations => {
                                   const publicConfigs = [];
                                   configurations.forEach(configuration => {
                                       this.publicConfigNameList.has(configuration.config_name) && publicConfigs.push(configuration);
                                   });
                                   res.send(publicConfigs);
                               })
                               .catch(e => res.send({
                                   api_status : 'fail',
                                   api_message: `unexpected generic api error: (${e})`
                               }));
    }
}


export default new _hXwPQrVhLEALFsIJ();
