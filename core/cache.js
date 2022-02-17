import _ from 'lodash';
import task from './task';


class Cache {
    constructor() {
        this.initialized = false;
        this.jobRunning  = false;
        this.cache       = {};
    }

    _purgeCache() {
        const now = Date.now();
        _.each(_.keys(this.cache), store => {
            _.each(_.keys(this.cache[store]), key => {
                if (now > this.cache[store][key].purge_time) {
                    delete this.cache[store][key];
                }
            });
        });
    }

    removeCacheItem(store, key) {
        if (this.cache[store] && this.cache[store][key]) {
            delete this.cache[store][key];
        }
    }

    refreshCacheTime(store, key, cacheTime = 30000) {
        if (this.cache[store] && this.cache[store][key]) {
            this.cache[store][key].purge_time = Date.now() + cacheTime;
        }
    }

    setCacheItem(store, key, value, cacheTime = 30000) {
        if (!this.cache[store]) {
            this.cache[store] = {};
        }

        this.cache[store][key] = {
            value,
            purge_time: Date.now() + cacheTime
        };
    }

    getCachedIfPresent(store, key, getter, cacheTime = 30000) {
        const cachedItem = this.getCacheItem(store, key);
        return cachedItem ? Promise.resolve(cachedItem) : getter().then(value => {
            this.setCacheItem(store, key, value, cacheTime);
            return value;
        });
    }

    getCacheItem(store, key) {
        if (this.cache[store] && this.cache[store][key]) {
            return this.cache[store][key].value;
        }
        return null;
    }

    initialize() {
        if (this.initialized) {
            if (!this.jobRunning) {
                task.scheduleTask('cache_purge', this._purgeCache.bind(this), 30000);
            }
            return Promise.resolve();
        }

        this.initialized = true;
        task.scheduleTask('cache_purge', this._purgeCache.bind(this), 30000);
        return Promise.resolve();
    }

    stop() {
        task.removeTask('cache_purge');
        this.jobRunning = false;
    }
}


export default new Cache();
