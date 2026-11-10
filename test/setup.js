// loaded with --require before every test file. it compiles the node's es
// modules with babel, the same way babel-node runs the node, and replaces the
// ntp clock with the local clock: core/ntp.js asks an ntp server for the time
// as soon as it is imported, and the tests must not use the network.
//
// the tests run with the default configuration whatever a local
// core/config/environment.js says. TEST_MODE_TEST_NETWORK=1 runs them with
// the test network's address and transaction versions.
require('@babel/register');

const path   = require('path');
const Module = require('module');

function setModule(modulePath, exports) {
    const module          = new Module(modulePath, null);
    module.filename       = modulePath;
    module.loaded         = true;
    module.exports        = exports;
    require.cache[modulePath] = module;
}

setModule(path.join(__dirname, '..', 'core', 'config', 'environment.js'), {
    __esModule: true,
    default   : process.env.TEST_MODE_TEST_NETWORK === '1' ? {MODE_TEST_NETWORK: true} : {}
});

setModule(path.join(__dirname, '..', 'core', 'ntp.js'), {
    __esModule: true,
    default   : {
        offset     : 0,
        initialized: true,
        now        : () => new Date()
    }
});
