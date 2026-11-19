// Keep validator tests independent of local configuration, databases and sockets.
require('@babel/register')({cache: false});

const path   = require('path');
const Module = require('module');
const root   = path.join(__dirname, '..');

// The optional environment.js need not exist. Intercept its load only while
// evaluating config so both network profiles work without creating that file.
const configPath = path.join(root, 'core', 'config', 'config.js');
const load       = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === './environment' && parent && parent.filename === configPath) {
        return {default: {MODE_TEST_NETWORK: process.env.TEST_MODE_TEST_NETWORK === '1'}};
    }
    return load.apply(this, arguments);
};
try {
    require(configPath);
}
finally {
    Module._load = load;
}

function stubModule(relativePath, value) {
    const filename = path.join(root, relativePath);
    const module   = new Module(filename);
    module.filename = filename;
    module.loaded   = true;
    module.exports  = {__esModule: true, default: value};
    require.cache[filename] = module;
}

stubModule('database/database.js', {
    getRepository() {
        throw Error('test repository not configured');
    }
});
stubModule('database/repositories/node.js', class {});
stubModule('net/network.js', {});
stubModule('core/ntp.js', {
    now: () => new Date('2026-11-19T12:00:00Z')
});
