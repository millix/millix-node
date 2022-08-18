import winston from 'winston';
import config from './config/config';
import path from 'path';
import os from 'os';


class _Logger {
    // Define your severity levels.
    // With them, You can create log files,
    // see or hide levels based on the running ENV.
    static LEVELS = {
        error: 0,
        warn : 1,
        info : 2,
        http : 3,
        debug: 4
    };

    // Define different colors for each level.
    // Colors make the log message more visible,
    // adding the ability to focus or ignore messages.
    static COLORS = {
        error: 'red',
        warn : 'yellow',
        info : 'green',
        http : 'magenta',
        debug: 'white'
    };

    // This method set the current severity based on
    // the current NODE_ENV: show all the log levels
    // if the server was run in development mode; otherwise,
    // if it was run in production, show only warn and error messages.
    level() {
        const env           = process.env.NODE_ENV || 'development';
        const isDevelopment = env === 'development';
        return isDevelopment ? 'debug' : 'warn';
    };

    constructor() {
        this.initialized = false;
    }

    getLogger(loggerName) {
        return this.logger.child({service: loggerName});
    }

    _getFormat() {
        // Chose the aspect of your log customizing the log format.
        return winston.format.combine(
            // Add the message timestamp with the preferred format
            winston.format.timestamp({format: 'YYYY-MM-DD HH:mm:ss:ms'}),
            // Define the format of the message showing the timestamp, the
            // level and the message
            winston.format.printf(
                (info) => `${info.timestamp} ${info.service} ${info.level}: ${info.message}`
            )
        );
    }

    _getConfig() {
        // Define which transports the logger must use to print out messages.
        // In this example, we are using three different transports
        const transports = [
            // Allow to print all the error level messages inside the error.log
            // file
            new winston.transports.File({
                filename        : path.join(config.DATABASE_CONNECTION.FOLDER, '/logs/error.log'),
                handleExceptions: true,
                handleRejections: true,
                level           : 'error'
            })
        ];

        return {
            level      : this.level(),
            levels     : _Logger.LEVELS,
            format     : this._getFormat(),
            transports,
            exitOnError: false
        };
    }

    initialize() {
        if (!this.initialized) {
            // Tell winston that you want to link the colors
            // defined above to the severity levels.
            winston.addColors(_Logger.COLORS);
            // Create the logger instance that has to be exported
            // and used to log messages.
            this.logger = winston.createLogger(this._getConfig());
            //
            // If we're not in production then log to the `console`
            //
            if (process.env.NODE_ENV !== 'production') {
                this.logger.add(// Allow the use the console to print the messages
                    new winston.transports.Console({
                        handleExceptions: true,
                        handleRejections: true,
                        format: winston.format.combine(
                            this._getFormat(),
                            // Tell Winston that the logs must be colored
                            winston.format.colorize({all: true})
                        )
                    }));
            }
        }
        return Promise.resolve();
    }
}


export default new _Logger();
