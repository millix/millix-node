import config from '../config/config';

export default {
    genesis_transaction: config.MODE_TEST_NETWORK ? '2sDCsRbDCaM3znBSC9bXcwWPdYdPi6uYTXQYb8R8uikn7mvad4' : '2VngVznbdiQ5tqfWqn2NMP8DijqCbLX79Gygo9yYRVFU6iN35h',
    genesis_shard_id   : config.MODE_TEST_NETWORK ? 'PjqVBYLaKUpb9Cpfi6V6rLZjs9QejTUPuop2b62Nvrg51aC7s' : 'qGuUgMMVmaCvqrvoWG6zARjkrujGMpzJmpNhBgz1y3RjBG7ZR'
};
