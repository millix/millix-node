import Endpoint from '../endpoint';
import os from 'os';


/**
 * api get_os_info
 */
class _RLOk0Wji0lQVjynT extends Endpoint {
    constructor() {
        super('RLOk0Wji0lQVjynT');
    }

    /**
     * returns the node os info
     * @param app
     * @param req
     * @param res
     */
    handler(app, req, res) {
        try {
            const osCpus = {
                model: {},
                speed: {}
            };
            for (let c = 0; c < os.cpus().length; c++) {
                osCpus.model[os.cpus()[c].model] = (osCpus.model[os.cpus()[c].model] || 0) + 1;
                osCpus.speed[os.cpus()[c].speed] = (osCpus.speed[os.cpus()[c].speed] || 0) + 1;
            }

            let cpu = {
                model: [],
                speed: []
            };
            for (const p in osCpus.model) {
                cpu.model.push(osCpus.model[p] + ' × ' + p);
            }
            for (const p in osCpus.speed) {
                cpu.speed.push(osCpus.speed[p] + ' × ' + p);
            }
            cpu.model = cpu.model.join(', ');
            cpu.speed = cpu.speed.join(', ') + ' MHz';

            let memory = {
                total      : Math.round((os.totalmem() / 1024 / 1024 / 1024) * 100) / 100 + 'GB',
                free       : Math.round((os.freemem() / 1024 / 1024 / 1024) * 100) / 100 + 'GB',
                freePercent: Math.round(os.freemem() / os.totalmem() * 100).toString() + '%'
            };

            res.send({
                type    : os.type(),
                platform: os.platform(),
                release : os.release(),
                arch    : os.arch(),
                cpu     : cpu,
                memory  : memory
            });
        }
        catch (e) {
            res.send({
                api_status : 'fail',
                api_message: `unexpected generic api error: (${e})`
            });
        }
    }
}


export default new _RLOk0Wji0lQVjynT();
