import Endpoint from '../endpoint';
import config, {DATABASE_CONNECTION} from '../../core/config/config';


/**
 * api get_storage_config
 */
class _kIoe20LWh2aw3CAu extends Endpoint {
    constructor() {
        super('kIoe20LWh2aw3CAu');
    }

    /**
     * returns storage related config
     * @param app
     * @param req
     * @param res
     */
    handler(app, req, res) {
        res.send({
            api_status  : 'success',
            file_dir    : config.STORAGE_CONNECTION.FOLDER,
            database_dir: DATABASE_CONNECTION.FOLDER
        });
    }
}


export default new _kIoe20LWh2aw3CAu();
