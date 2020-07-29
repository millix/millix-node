import config from '../config/config';

export default {
    genesis_transaction: config.MODE_TEST_NETWORK ? 'z83hpG6RVcyUwq6nFsw1jiMgPLhdoMabiNQX8rNW5rrwMEfDy' : '2VngVznbdiQ5tqfWqn2NMP8DijqCbLX79Gygo9yYRVFU6iN35h',
    genesis_shard_id   : config.MODE_TEST_NETWORK ? 'UqnsGsRQGtxK3z5yURxt23MX2A7u5wAsMmTvYqrzqACD2W4ne' : 'qGuUgMMVmaCvqrvoWG6zARjkrujGMpzJmpNhBgz1y3RjBG7ZR'
};
