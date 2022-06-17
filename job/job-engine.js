import defaultConfigJobEngine from '../core/config/job.json';
import _ from 'lodash';
import async from 'async';
import database from '../database/database';
import task from '../core/task';
import mutex from '../core/mutex';
import ntp from '../core/ntp';
import network from '../net/network';
import peer from '../net/peer';
import wallet from '../core/wallet/wallet';
import walletSync from '../core/wallet/wallet-sync';
import walletTransactionConsensus from '../core/wallet/wallet-transaction-consensus';
import config from '../core/config/config';
import moment from 'moment';
import fs from 'fs';
import console from '../core/console';
import path from 'path';
import os from 'os';


class JobEngine {
    static JOB_WAIT_TIME = 1000;

    constructor() {
        this.debug            = false;
        this.configJobEngine  = null;
        this.initialized      = false;
        this.running          = false;
        this.processorsStatus = {};
        this.modules          = {
            network,
            wallet,
            peer,
            'wallet-transaction-consensus': walletTransactionConsensus,
            'wallet-sync'                 : walletSync
        };
    }

    _isJobRunDate(job, date) {
        const dayOfMonth = [
            '#sunday#',
            '#monday#',
            '#tuesday#',
            '#wednesday#',
            '#thursday#',
            '#friday#',
            '#saturday#'
        ];
        return ((!job.run_date || job.run_date === '')
                || new Date(job.run_date).getDate() === date.getDate()
                || dayOfMonth[date.getDay()] === job.run_date
                || job.run_date === '#last_day_of_month#' && date.getDate() === moment().endOf('month').date()
                || job.run_date === '#last_day_of_year#' && date.getDate() === 31 && date.getMonth() === 11
                || job.run_date === '#last_day_of_year#' && date.getDate() === 31 && date.getMonth() === 11
                || job.run_date === '#first_day_of_year#' && date.getDate() === 1 && date.getMonth() === 0)
               && (!job.last_date_end || !job.run_delay || date.getTime() - job.last_date_end >= job.run_delay);

    }

    _getJob(processorID) {
        return this.jobRepository.getJobReadyToRun(processorID)
                   .then(jobs => {
                       const now = ntp.now();
                       for (let job of jobs) {
                           if ((job.run_always === 1 && now.getTime() - job.last_date_end >= job.run_delay)
                               || (job.run_every === 1 && this._isJobRunDate(job, now))
                               || (job.run_at &&
                                   moment(job.run_at, 'hh:mm:ss').isBetween(moment(now).subtract(55, 'seconds'), moment(now).add(55, 'seconds')) &&
                                   this._isJobRunDate(job, now))
                               || (job.run_on_the !== null &&
                                   moment(now).minutes() === job.run_on_the &&
                                   this._isJobRunDate(job, now))) {
                               return job;
                           }
                       }
                   });
    }

    _getTask(processorTag, processorID) {
        if (this.debug) {
            _.each(_.keys(this.processorsStatus), tag => {
                const status = this.processorsStatus[tag];
                console.log('tag: ', tag, ' | job: ', status.job, ' | last run: ', (Date.now() - status.timestamp) / 1000, 'seconds ago');
            });
        }
        this.processorsStatus[processorTag] = {
            running  : true,
            timestamp: Date.now()
        };
        mutex.lock(['job-engine'], (unlock) => {
            this._getJob(processorID)
                .then(job => {
                    if (job) {
                        this.processorsStatus[processorTag]['job'] = job.job_name;
                        this.debug && console.log(`[job-engine] running job ${job.job_id} : ${job.job_name}`);
                        let unlocked         = false;
                        const timestampBegin = ntp.now();
                        const payload        = JSON.parse(job.job_payload);
                        const module         = payload ? this.modules[payload.module] : undefined;
                        return this.jobRepository.updateJobProgressStatus(job.job_id, 1, {last_date_begin: timestampBegin})
                                   .then(() => this.jobRepository.lockJobObject(job.job_id))
                                   .then(() => {
                                       unlock();
                                       unlocked = true;
                                       // run job
                                       if (job.job_type_id === this.types['function']) {
                                           this.debug && console.log(`[job-engine] running function ${payload.module}:${payload.function_name}`);

                                           if (!module || !payload || !module[payload.function_name]) {
                                               return Promise.reject('job_invalid');
                                           }

                                           let postJob = () => {
                                               const timestampEnd = ntp.now();
                                               const lastElapse   = timestampEnd.getTime() - timestampBegin.getTime();
                                               this.debug && console.log(`[job-engine] done ${payload.module}:${payload.function_name} - ${lastElapse} ms`);
                                               return new Promise((resolve, reject) => {
                                                   mutex.lock(['job-engine'], (unlockUpdate) => {
                                                       this.jobRepository.updateJobProgressStatus(job.job_id, 0, {
                                                           last_date_end: timestampEnd,
                                                           last_elapse  : lastElapse,
                                                           last_response: 'done'
                                                       })
                                                           .then(() => this.jobRepository.unlockJobObject(job.job_id))
                                                           .then(() => {
                                                               unlockUpdate();
                                                               resolve();
                                                           })
                                                           .catch(() => {
                                                               unlockUpdate();
                                                               reject();
                                                           });
                                                   });
                                               });
                                           };

                                           return module[payload.function_name]()
                                               .then(postJob)
                                               .catch(postJob);
                                       }
                                       else {
                                           return Promise.reject('job_not_supported');
                                       }
                                   })
                                   .catch(() => {
                                       const timestampEnd = ntp.now();
                                       const lastElapse   = timestampEnd.getTime() - timestampBegin.getTime();
                                       this.debug && console.log(`[job-engine] done ${payload.module}:${payload.function_name} - ${lastElapse} ms`);
                                       mutex.lock(['job-engine'], (unlockUpdate) => {
                                           let postJob = () => {
                                               this.processorsStatus[processorTag]['running'] = false;
                                               unlockUpdate();
                                               if (!unlocked) {
                                                   unlock();
                                               }
                                               this.running && task.scheduleTask(processorTag, this._getTask.bind(this, processorTag, processorID), JobEngine.JOB_WAIT_TIME, false, true);
                                           };

                                           this.jobRepository
                                               .updateJobProgressStatus(job.job_id, 0, {
                                                   last_date_end: ntp.now(),
                                                   last_elapse  : 0,
                                                   last_response: 'fail'
                                               })
                                               .then(() => this.jobRepository.unlockJobObject(job.job_id))
                                               .then(postJob)
                                               .catch(postJob);
                                       });
                                   });
                    }
                    else {
                        return Promise.reject('job_not_found');
                    }
                })
                .then(() => {
                    this.processorsStatus[processorTag]['running'] = false;
                    this.running && task.scheduleTask(processorTag, this._getTask.bind(this, processorTag, processorID), 500, false, true);
                })
                .catch(() => {
                    this.processorsStatus[processorTag]['running'] = false;
                    unlock();
                    this.running && task.scheduleTask(processorTag, this._getTask.bind(this, processorTag, processorID), JobEngine.JOB_WAIT_TIME, false, true);
                });
        });
    }

    _run() {
        if (this.running) {
            return Promise.resolve();
        }
        this.running              = true;
        const localhostProcessors = _.filter(_.keys(this.configJobEngine.processor_list), processor => processor.startsWith('localhost'));
        _.each(localhostProcessors, processorName => {
            for (let i = 0; i < this.configJobEngine.processor_list[processorName].instances; i++) {
                const processorTag = `job-engine-processor [${processorName}-${i}]`;
                this.debug && console.log('[job-engine] starting processor', processorTag);
                task.scheduleTask(processorTag, this._getTask.bind(this, processorTag, this.processors[processorName]), 0, false, true);
            }
        });

        return Promise.resolve();
    }

    _isJobEnabled(job) {
        if (!job.option_list) {
            return true;
        }

        if (job.option_list.enable === false) {
            return false;
        }

        return true;
    }

    loadConfig(resetConfig) {
        return new Promise(resolve => {
            const configFilePath = config.JOB_CONFIG_PATH;
            if (!fs.existsSync(configFilePath) || resetConfig) {
                this.configJobEngine = defaultConfigJobEngine;
                fs.writeFile(configFilePath, JSON.stringify(this.configJobEngine, null, '\t'), 'utf8', (err) => {
                    if (err) {
                        throw Error('failed to write keys file');
                    }
                    resolve();
                });
            }
            else {
                fs.readFile(configFilePath, 'utf8', (err, data) => {
                    if (err) {
                        throw Error(err.message);
                    }
                    try {
                        this.configJobEngine = JSON.parse(data);
                        if (this.configJobEngine.version !== config.JOB_CONFIG_VERSION) {
                            // backup the old configuration file
                            fs.writeFile(configFilePath + '.old', JSON.stringify(this.configJobEngine, null, '\t'), 'utf8', (err) => {
                                if (err) {
                                    throw Error('failed to write keys file');
                                }
                                this.loadConfig(true).then(resolve);
                            });
                        }
                        else {
                            resolve();
                        }
                    }
                    catch (e) {
                        return this.loadConfig(true).then(resolve);
                    }
                });
            }
        });
    }

    initialize() {
        return new Promise(resolve => {
            this._initialize()
                .then(() => resolve())
                .catch(() => {
                    this._run().then(() => resolve());
                });
        });
    }

    stop() {
        if (!this.running || !this.initialized) {
            return;
        }
        this.running = false;
        for (let i = 0; i < this.configJobEngine.processor_list['localhost'].instances; i++) {
            const processorTag = `job-engine-processor [localhost-${i}]`;
            task.removeTask(processorTag);
        }

        for (let i = 0; i < this.configJobEngine.processor_list['localhost_watchdog'].instances; i++) {
            const processorWatchdogTag = `job-engine-processor [localhost-${i}-watchdog]`;
            task.removeTask(processorWatchdogTag);
        }
    }

    _initialize() {
        if (this.initialized) {
            return Promise.reject();
        }
        this.initialized  = true;
        let jobRepository = database.getRepository('job');
        const processors  = {};
        const objects     = {};
        const groups      = {};
        const types       = {};
        const jobs        = {};
        return new Promise(resolve => {
            async.waterfall([
                (callback) => this.loadConfig().then(callback),
                (callback) => jobRepository.cleanAll().then(callback),
                (callback) => { // add processors
                    this.debug && console.log('[job-engine] loading processors');
                    async.eachSeries(_.keys(this.configJobEngine.processor_list), (processorName, processorCallback) => {
                        const processor = this.configJobEngine.processor_list[processorName];
                        this.debug && console.log('[job-engine] loading processor', processorName);
                        jobRepository.getJobProcessor(processorName)
                                     .then(entry => {
                                         processors[processorName] = entry.processor_id;
                                         processorCallback();
                                     })
                                     .catch(() => {
                                         jobRepository.addJobProcessor(processorName, processor.port, processor.user, processor.password)
                                                      .then(processorID => {
                                                          processors[processorName] = processorID;
                                                          processorCallback();
                                                      });
                                     });
                    }, callback);
                },
                (callback) => { // add objects
                    this.debug && console.log('[job-engine] loading objects');
                    async.eachSeries(_.keys(this.configJobEngine.object_list), (objectName, objectCallback) => {
                        this.debug && console.log('[job-engine] loading object', objectName);
                        jobRepository.getObject(objectName)
                                     .then(entry => {
                                         objects[objectName] = entry.object_id;
                                         objectCallback();
                                     })
                                     .catch(() => {
                                         jobRepository.addObject(objectName, this.configJobEngine.object_list[objectName])
                                                      .then(objectID => {
                                                          objects[objectName] = objectID;
                                                          objectCallback();
                                                      });
                                     });
                    }, callback);
                },
                (callback) => { // add groups
                    this.debug && console.log('[job-engine] loading groups');
                    const groupNames = new Set();
                    _.each(this.configJobEngine.job_list, jobEntry => groupNames.add(jobEntry.group));
                    async.eachSeries(Array.from(groupNames), (groupName, groupCallback) => {
                        this.debug && console.log('[job-engine] loading group', groupName);
                        jobRepository.getJobGroup(groupName)
                                     .then(entry => {
                                         groups[groupName] = entry.job_group_id;
                                         groupCallback();
                                     })
                                     .catch(() => {
                                         jobRepository.addJobGroup(groupName)
                                                      .then(groupID => {
                                                          groups[groupName] = groupID;
                                                          groupCallback();
                                                      });
                                     });
                    }, callback);
                },
                (callback) => { // add types
                    this.debug && console.log('[job-engine] loading types');
                    const typeNames = new Set();
                    _.each(this.configJobEngine.job_list, jobEntry => typeNames.add(jobEntry.type));
                    async.eachSeries(Array.from(typeNames), (typeName, typeCallback) => {
                        this.debug && console.log('[job-engine] loading type', typeName);
                        jobRepository.getJobTypeID(typeName)
                                     .then(entry => {
                                         types[typeName] = entry.job_type_id;
                                         typeCallback();
                                     })
                                     .catch(() => {
                                         jobRepository.addJobType(typeName)
                                                      .then(typeID => {
                                                          types[typeName] = typeID;
                                                          typeCallback();
                                                      });
                                     });
                    }, callback);
                },
                (callback) => { // add jobs
                    this.debug && console.log('[job-engine] loading jobs');
                    async.eachSeries(_.keys(this.configJobEngine.job_list), (jobName, jobCallback) => {
                        const jobEntry = this.configJobEngine.job_list[jobName];
                        this.debug && console.log('[job-engine] loading job', jobName);
                        jobRepository.getJob(jobName)
                                     .then(job => {
                                         jobs[jobName] = job.job_id;
                                         return jobRepository.updateJobStatus(job.job_id, this._isJobEnabled(jobEntry));
                                     })
                                     .then(() => jobCallback())
                                     .catch(() => {
                                         jobEntry.option_list['status'] = this._isJobEnabled(jobEntry);
                                         delete jobEntry.option_list['enable'];
                                         jobRepository.addJob(jobName, processors[jobEntry.processor], groups[jobEntry.group], types[jobEntry.type], JSON.stringify(jobEntry.payload), jobEntry.priority, jobEntry.option_list)
                                                      .then(jobID => {
                                                          jobs[jobName] = jobID;
                                                      }).then(() => jobCallback());
                                     });
                    }, callback);
                },
                (callback) => { // add job objects
                    this.debug && console.log('[job-engine] loading job objects');
                    async.eachSeries(_.keys(this.configJobEngine.job_list), (jobName, jobCallback) => {
                        const jobEntry = this.configJobEngine.job_list[jobName];
                        async.eachSeries(jobEntry.object_list, (objectName, jobObjectCallback) => {
                            this.debug && console.log('[job-engine] loading job object', jobName, '-', objectName);
                            jobRepository.addJobObject(jobs[jobName], objects[objectName])
                                         .then(() => jobObjectCallback())
                                         .catch(() => jobObjectCallback());
                        }, () => jobCallback());
                    }, callback);
                },
                (callback) => {
                    this.jobRepository = jobRepository;
                    this.processors    = processors;
                    this.objects       = objects;
                    this.groups        = groups;
                    this.types         = types;
                    this.jobs          = jobs;
                    this._run();
                    callback();
                    resolve();
                }
            ]);
        });
    }
}


export default new JobEngine();
