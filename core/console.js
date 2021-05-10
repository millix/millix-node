import config from './config/config';

let enabled       = true;
console.disable   = () => enabled = false;
console.enable    = () => enabled = true;
const _consoleLog = console.log;
const filters     = [];

console.addFilter = function(filter) {
    filters.push(filter);
};

console.log       = function() {
    let showLog = true;
    if(filters.length > 0) {
        const regex = new RegExp(`^\\[(${filters.join('|')})[^\\]]*\\]`, "m");
        showLog = !!regex.exec(arguments[0]);
    }
    enabled && showLog && config.MODE_DEBUG && _consoleLog.apply(console, arguments);
};

export default console;
