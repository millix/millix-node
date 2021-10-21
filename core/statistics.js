class Statistics {

    constructor() {
        this.messageCounter = {};
        this.messageCounter['last_update'] = Date.now();
    }


    newEvent(type) {
        if (this.messageCounter[type]) {
            this.messageCounter[type]++;
        }
        else {
            this.messageCounter[type] = 1;
        }
        if (Date.now() - this.messageCounter['last_update'] > 10000) {
            console.log('[statistics] ', this.messageCounter);
            this.messageCounter['last_update'] = Date.now();
        }
    }
}


export default new Statistics();
