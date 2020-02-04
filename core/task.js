class Task {
    constructor() {
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

            console.log(`Running task: ${taskName}`);
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
                task();
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
