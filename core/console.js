import config from './config/config';

const _consoleLog = console.log;
console.log      = function() {
    config.MODE_DEBUG && _consoleLog.apply(console, arguments);
};

export default console;
