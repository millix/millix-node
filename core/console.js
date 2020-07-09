import config from './config/config';
let enabled = true;
console.disable = () => enabled = false;
console.enable = () => enabled = true;
const _consoleLog = console.log;
console.log      = function() {
    enabled && config.MODE_DEBUG && _consoleLog.apply(console, arguments);
};

export default console;
