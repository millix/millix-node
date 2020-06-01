import task from './task';
import eventBus from './event-bus';
import mutex from './mutex';
import ntp from './ntp';
import moment from 'moment';


class LogManager {
    constructor(updateFrequency, logSize) {
        this.logsCache       = [];
        this.backLogSize     = 0;
        this.started         = false;
        this.updateFrequency = updateFrequency;
        this.logSize         = logSize;
        this.log             = [];
        this._onUpdate       = null;
    }

    setOnUpdate(callback) {
        this._onUpdate = callback;
    }

    _update() {
        this._onUpdate && this._onUpdate();
        if (this.logSize > 0) {
            let excess = (this.log.length + this.logsCache.length) - this.logSize;
            if (excess > 0) {
                this.log.splice(this.log.length - excess);
            }
            this.log = [
                ...this.logsCache,
                ...this.log
            ];
        }
        this.logsCache = [];
    }

    getTime() {
        if (!ntp.initialized) {
            return 'undefined';
        }

        let clock = new Date();
        clock.setUTCMilliseconds(clock.getUTCMilliseconds() + ntp.offset);
        return moment.utc(clock).format('YYYY-MM-DD HH:mm:ss');
    }

    initialize() {
        if (this.started) {
            return Promise.resolve();
        }
        task.scheduleTask('update log', this._update.bind(this), this.updateFrequency);
        this.started = true;

        eventBus.on('node_event_log', data => {
            this.addLog(data, this.getTime());
            this.setBacklogSize(mutex.getKeyQueuedSize(['transaction'], true));
        });
        eventBus.on('wallet_event_log', data => {
            this.addLog(data, this.getTime());
            this.setBacklogSize(mutex.getKeyQueuedSize(['transaction'], true));
        });

        return Promise.resolve();
    }

    stop() {
        task.removeTask('update log');
        this.started     = false;
        this.logsCache   = [];
        this.backLogSize = 0;
    }

    setBacklogSize(size) {
        this.backLogSize = size;
    }

    addLog(data, timestamp) {
        if (!this.started) {
            return;
        }
        this.logsCache.push({
            ...data,
            content: JSON.stringify(data.content || '', null, '\t'),
            type   : data.type.split(':')[0],
            timestamp
        });
    }
}


export default new LogManager(250, 1000);
