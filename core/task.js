class Task {
    constructor() {
        this.debug = false;
        this.runningTask = {};
    }

    scheduleTask(taskName, task, waitTime, asyncTask, once) {
        let self   = this;
        let taskID = this.runningTask[taskName];

        if (taskID) {
            clearTimeout(taskID);
        }

        this.runningTask[taskName] = setTimeout(function run() {
            if (!self.runningTask[taskName]) {
                return;
            }

            this.debug && console.log(`[task] running ${taskName}`);
            if (asyncTask) {
                task().then(() => {
                    if (!once) {
                        self.runningTask[taskName] = setTimeout(run, waitTime);
                    }
                    else {
                        delete self.runningTask[taskName];
                    }
                });
            }
            else {
                try {
                    task();
                }
                catch (e) {
                    this.debug && console.log(`[task] error running task ${taskName}: ${e}`);
                }

                if (!once) {
                    self.runningTask[taskName] = setTimeout(run, waitTime);
                }
                else {
                    delete self.runningTask[taskName];
                }

            }
        }, waitTime);
    }

    removeTask(taskName) {
        clearTimeout(this.runningTask[taskName]);
        delete this.runningTask[taskName];
    }
}


export default new Task();
