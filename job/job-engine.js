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
import walletTransactionConsensus from '../core/wallet/wallet-transaction-consensus';
import config from '../core/config/config';
import moment from 'moment';
import fs from 'fs';
import console from '../core/console';
import path from 'path';
import os from 'os';


class JobEngine {
    constructor() {
        this.configJobEngine = null;
        this.modules         = {
            network,
            wallet,
            peer,
            'wallet-transaction-consensus': walletTransactionConsensus
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
        mutex.lock(['job-engine'], (unlock) => {
            this._getJob(processorID)
                .then(job => {
                    if (job) {
                        console.log(`[job-engine] running job ${job.job_id} : ${job.job_name}`);
                        let unlocked         = false;
                        const timestampBegin = ntp.now();
                        this.jobRepository.updateJobProgressStatus(job.job_id, 1, {last_date_begin: timestampBegin})
                            .then(() => this.jobRepository.lockJobObject(job.job_id))
                            .then(() => {
                                unlock();
                                unlocked = true;
                                // run job
                                if (job.job_type_id === this.types['function']) {
                                    const payload = JSON.parse(job.job_payload);
                                    const module  = this.modules[payload.module];
                                    console.log(`[job-engine] running function ${payload.module}:${payload.function_name}`);

                                    let postJob = () => {
                                        const timestampEnd = ntp.now();
                                        const lastElapse   = timestampEnd.getTime() - timestampBegin.getTime();
                                        console.log(`[job-engine] done ${payload.module}:${payload.function_name} - ${lastElapse} ms`);
                                        this.jobRepository.updateJobProgressStatus(job.job_id, 0, {
                                            last_date_end: timestampEnd,
                                            last_elapse  : lastElapse,
                                            last_response: 'done'
                                        })
                                            .then(() => this.jobRepository.unlockJobObject(job.job_id))
                                            .then(() => task.scheduleTask(processorTag, this._getTask.bind(this, processorTag, processorID), 500, false, true))
                                            .catch(() => task.scheduleTask(processorTag, this._getTask.bind(this, processorTag, processorID), 500, false, true));
                                    };

                                    module[payload.function_name]()
                                        .then(postJob)
                                        .catch(postJob);
                                }
                                else {
                                    this.jobRepository
                                        .updateJobProgressStatus(job.job_id, 0, {
                                            last_date_end: ntp.now(),
                                            last_elapse  : 0,
                                            last_response: 'fail'
                                        })
                                        .then(() => this.jobRepository.unlockJobObject(job.job_id))
                                        .then(() => task.scheduleTask(processorTag, this._getTask.bind(this, processorTag, processorID), 500, false, true))
                                        .catch(() => task.scheduleTask(processorTag, this._getTask.bind(this, processorTag, processorID), 500, false, true));

                                }
                            })
                            .catch(() => {
                                let postJob = () => {
                                    if (!unlocked) {
                                        unlock();
                                    }
                                    task.scheduleTask(processorTag, this._getTask.bind(this, processorTag, processorID), 500, false, true);
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
                    }
                    else {
                        unlock();
                        task.scheduleTask(processorTag, this._getTask.bind(this, processorTag, processorID), 500, false, true);
                    }
                });
        });
    }

    _run() {
        for (let i = 0; i < this.configJobEngine.processor_list['localhost'].instances; i++) {
            const processorTag = `job-engine-processor [localhost-${i}]`;
            console.log('[job-engine] starting processor', processorTag);
            task.scheduleTask(processorTag, this._getTask.bind(this, processorTag, this.processors['localhost']), 0, false, true);
        }

        for (let i = 0; i < this.configJobEngine.processor_list['localhost_watchdog'].instances; i++) {
            const processorTag = `job-engine-processor [localhost-${i}-watchdog]`;
            console.log('[job-engine] starting watchdog processor', processorTag);
            task.scheduleTask(processorTag, this._getTask.bind(this, processorTag, this.processors['localhost_watchdog']), 0, false, true);
        }
    }

    _isJobEnabled(job) {
        if (!job.option_list) {
            return true;
        }

        if (job.option_list.enable === false) {
            return false;
        }

        if (job.option_list.enable === '!MODE_NODE_FULL') {
            return !config.MODE_NODE_FULL;
        }

        return true;
    }

    loadConfig() {
        return new Promise(resolve => {
            const configFilePath = path.join(os.homedir(), config.JOB_CONFIG_PATH);
            if (!fs.existsSync(configFilePath)) {
                this.configJobEngine = defaultConfigJobEngine;
                fs.writeFile(configFilePath, JSON.stringify(this.configJobEngine, null, '\t'), 'utf8', function(err) {
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
                    this.configJobEngine = JSON.parse(data);
                    resolve();
                });
            }
        });
    }

    initialize() {
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
                    console.log('[job-engine] loading processors');
                    async.eachSeries(_.keys(this.configJobEngine.processor_list), (processorName, processorCallback) => {
                        const processor = this.configJobEngine.processor_list[processorName];
                        console.log('[job-engine] loading processor', processorName);
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
                    console.log('[job-engine] loading objects');
                    async.eachSeries(_.keys(this.configJobEngine.object_list), (objectName, objectCallback) => {
                        console.log('[job-engine] loading object', objectName);
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
                    console.log('[job-engine] loading groups');
                    const groupNames = new Set();
                    _.each(this.configJobEngine.job_list, jobEntry => groupNames.add(jobEntry.group));
                    async.eachSeries(Array.from(groupNames), (groupName, groupCallback) => {
                        console.log('[job-engine] loading group', groupName);
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
                    console.log('[job-engine] loading types');
                    const typeNames = new Set();
                    _.each(this.configJobEngine.job_list, jobEntry => typeNames.add(jobEntry.type));
                    async.eachSeries(Array.from(typeNames), (typeName, typeCallback) => {
                        console.log('[job-engine] loading type', typeName);
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
                    console.log('[job-engine] loading jobs');
                    async.eachSeries(_.keys(this.configJobEngine.job_list), (jobName, jobCallback) => {
                        const jobEntry = this.configJobEngine.job_list[jobName];
                        console.log('[job-engine] loading job', jobName);
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
                    console.log('[job-engine] loading job objects');
                    async.eachSeries(_.keys(this.configJobEngine.job_list), (jobName, jobCallback) => {
                        const jobEntry = this.configJobEngine.job_list[jobName];
                        async.eachSeries(jobEntry.object_list, (objectName, jobObjectCallback) => {
                            console.log('[job-engine] loading job object', jobName, '-', objectName);
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
