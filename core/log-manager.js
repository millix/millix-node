import task from './task';

class LogManager {
    constructor(updateFrequency) {
        this.logsCache       = [];
        this.backLogSize     = 0;
        this.started         = false;
        this.updateFrequency = updateFrequency;
        this._onUpdate = null;
    }

    setOnUpdate(callback){
        this._onUpdate = callback;
    }

    _update() {
        this._onUpdate && this._onUpdate();
        this.logsCache = [];
    }

    start() {
        if (this.started) {
            return;
        }
        task.scheduleTask('update log', this._update.bind(this), this.updateFrequency);
        this.started = true;
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
            content  : JSON.stringify(data.content || '', null, '\t'),
            type     : data.type.split(':')[0],
            timestamp
        });
    }
}


export default new LogManager(250);
