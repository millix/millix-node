import Endpoint from '../endpoint';
import cloudVersion from '../../net/cloud-version';
import config from '../../core/config/config';


/**
 * api get_cloud_version_min
 */
class _tTO0e5B2JpyptfSs extends Endpoint {
    constructor() {
        super('tTO0e5B2JpyptfSs');
    }

    /**
     * returns the minimum node version for tangled cloud features, the
     * signed message that set it and whether this node's cloud features are
     * on
     * @param app
     * @param req
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        res.send({
            api_status   : 'success',
            version_min  : cloudVersion.getVersionMin(),
            node_version : config.NODE_MILLIX_VERSION,
            cloud_enabled: cloudVersion.isCloudEnabled(),
            message      : cloudVersion.message
        });
    }
}


export default new _tTO0e5B2JpyptfSs();
