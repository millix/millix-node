// loaded with --require before every test file. it compiles the node's es
// modules with babel, the same way babel-node runs the node, and replaces the
// ntp clock with the local clock: core/ntp.js asks an ntp server for the time
// as soon as it is imported, and the tests must not use the network.
require('@babel/register');

const path   = require('path');
const Module = require('module');

const ntpPath     = path.join(__dirname, '..', 'core', 'ntp.js');
const ntpModule   = new Module(ntpPath, null);
ntpModule.filename = ntpPath;
ntpModule.loaded   = true;
ntpModule.exports  = {
    __esModule: true,
    default   : {
        offset     : 0,
        initialized: true,
        now        : () => new Date()
    }
};
require.cache[ntpPath] = ntpModule;
