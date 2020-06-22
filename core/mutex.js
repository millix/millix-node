import _ from 'lodash';
import util from 'util';


class Mutex {
    constructor() {
        this.debug              = false;
        this.arrQueuedJobs      = {};
        this.arrLockedKeyArrays = [];
    }

    getCountOfQueuedJobs() {
        const counts = {};
        _.each(_.keys(this.arrQueuedJobs), (key) => {
            counts[key] = this.arrQueuedJobs[key].length;
        });
        return counts;
    }

    getKeyQueuedSize(arrKeys, startsWith) {
        const keyMatch = arrKeys.sort().join('_');
        if (startsWith) {
            return _.sum(_.map(_.keys(this.arrQueuedJobs), key => key.startsWith(keyMatch) ? this.arrQueuedJobs[key].length : 0));
        }
        else {
            return this.arrQueuedJobs[keyMatch] ? this.arrQueuedJobs[keyMatch].length : 0;
        }
    }

    getCountOfLocks() {
        return this.arrLockedKeyArrays.length;
    }

    isAnyOfKeysLocked(arrKeys) {
        for (let i = 0; i < this.arrLockedKeyArrays.length; i++) {
            const arrLockedKeys = this.arrLockedKeyArrays[i];
            for (let j = 0; j < arrLockedKeys.length; j++) {
                if (arrKeys.indexOf(arrLockedKeys[j]) !== -1) {
                    return true;
                }
            }
        }
        return false;
    }

    release(arrKeys) {
        for (let i = 0; i < this.arrLockedKeyArrays.length; i++) {
            if (_.isEqual(arrKeys, this.arrLockedKeyArrays[i])) {
                this.arrLockedKeyArrays.splice(i, 1);
                return;
            }
        }
    }

    exec(arrKeys, proc, nextProc) {
        this.arrLockedKeyArrays.push(arrKeys);
        this.debug && console.log('[mutex] lock acquired', arrKeys);
        const lockTime = new Date().getTime();
        let bLocked    = true;
        const self     = this;
        proc(function() {
            if (!bLocked) {
                throw Error('double unlock?');
            }
            bLocked = false;
            self.release(arrKeys);
            self.debug && console.log('[mutex] lock released', arrKeys, ' in ', new Date().getTime() - lockTime, 'ms');
            if (nextProc) {
                nextProc.apply(nextProc, arguments);
            }
            self.handleQueue(arrKeys[0]);
        });
    }

    handleQueue(key) {
        this.debug && console.log('[mutex] handleQueue ' + this.arrQueuedJobs[key].length + ' items');
        const now = Date.now();
        for (let i = 0; i < this.arrQueuedJobs[key].length; i++) {
            const job = this.arrQueuedJobs[key][i];
            if (this.isAnyOfKeysLocked(job.arrKeys)) {
                continue;
            }
            this.arrQueuedJobs[key].splice(i, 1); // do it before exec as exec
                                                  // can trigger another job
                                                  // added, another lock
                                                  // unlocked, another
                                                  // handleQueue called

            if (job.timestamp_max !== undefined && job.timestamp_max < now) {
                this.debug && console.log('[mutex] skipping job ', job.arrKeys, ' due to timeout (', now - job.timestamp_max, 'ms ago)');
                i--; // we've just removed one item
                continue;
            }

            this.debug && console.log('[mutex] starting job held by keys', job.arrKeys);
            this.exec(job.arrKeys, job.proc, job.next_proc);
            i--; // we've just removed one item
        }
        this.debug && console.log('[mutex] handleQueue done ' + this.arrQueuedJobs[key].length + ' items');
    }

    lock(arrKeys, proc, nextProc, maxTimestamp) {
        const key = arrKeys.sort().join('_');
        arrKeys   = [key];

        if (!this.arrQueuedJobs[key]) {
            this.arrQueuedJobs[key] = [];
        }

        let priority;
        if (typeof (nextProc) === 'boolean') {
            priority = true;
            nextProc = undefined;
        }
        else {
            priority = false;
        }

        if (this.isAnyOfKeysLocked(arrKeys)) {
            //this.debug && console.log("queuing job held by keys", arrKeys);
            if (!priority) {
                this.arrQueuedJobs[key].push({
                    arrKeys      : arrKeys,
                    proc         : proc,
                    next_proc    : nextProc,
                    timestamp    : Date.now(),
                    timestamp_max: maxTimestamp
                });
            }
            else {
                this.arrQueuedJobs[key].unshift({
                    arrKeys      : arrKeys,
                    proc         : proc,
                    next_proc    : nextProc,
                    timestamp    : Date.now(),
                    timestamp_max: maxTimestamp
                });
            }
        }
        else {
            this.exec(arrKeys, proc, nextProc);
        }
    }

    lockOrSkip(arrKeys, proc, nextProc) {
        if (this.isAnyOfKeysLocked(arrKeys)) {
            this.debug && console.log('[mutex] skipping job held by keys', arrKeys);
            if (nextProc) {
                next_proc();
            }
        }
        else {
            this.exec(arrKeys, proc, nextProc);
        }
    }

    checkForDeadlocks() {
        _.each(_.keys(this.arrQueuedJobs), key => {
            for (let i = 0; i < this.arrQueuedJobs[key].length; i++) {
                const job = this.arrQueuedJobs[key][i];
                if (Date.now() - job.timestamp > 30 * 1000) {
                    throw Error('possible deadlock on job ' + util.inspect(job) + ',\nproc:' + job.proc.toString() + ' \nall jobs: ' + util.inspect(this.arrQueuedJobs[key], {depth: null}));
                }
            }
        });
    }
}


export default new Mutex();
