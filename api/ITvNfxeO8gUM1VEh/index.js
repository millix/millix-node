import Endpoint from '../endpoint';
import cloudVersion from '../../net/cloud-version';


/**
 * api add_cloud_version_min
 */
class _ITvNfxeO8gUM1VEh extends Endpoint {
    constructor() {
        super('ITvNfxeO8gUM1VEh');
    }

    /**
     * takes a minimum version message signed with tangled's key
     * (scripts/cloud/sign-version-min.js) and, if it is valid and newer than
     * the one this node has, keeps it and sends it to all peers
     * @param app
     * @param req (p0: message<required> (json))
     * @param res
     * @returns {*}
     */
    handler(app, req, res) {
        let message;
        try {
            message = JSON.parse(req.query.p0);
        }
        catch (e) {
            return res.status(400).send({
                api_status : 'fail',
                api_message: 'p0<message> must be the signed message as json'
            });
        }

        cloudVersion.addMessage(message)
                    .then(isNew => {
                        isNew && cloudVersion.propagateMessage();
                        res.send({
                            api_status   : 'success',
                            message_new  : isNew,
                            version_min  : cloudVersion.getVersionMin(),
                            cloud_enabled: cloudVersion.isCloudEnabled()
                        });
                    })
                    .catch(e => res.send({
                        api_status : 'fail',
                        api_message: `${e}`
                    }));
    }
}


export default new _ITvNfxeO8gUM1VEh();
