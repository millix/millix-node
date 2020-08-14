import config from '../config/config';

export default {
    genesis_transaction: config.MODE_TEST_NETWORK ? 'wFtfcYFJb75bJCGU3HVsPCRg8RDHnMmsRL565BSaeu3aidqQN' : '2VngVznbdiQ5tqfWqn2NMP8DijqCbLX79Gygo9yYRVFU6iN35h',
    genesis_shard_id   : config.MODE_TEST_NETWORK ? '2qkemPc9SozT4r8TdcMgyv9DxgE8m4qUkEJ2eBRQLCNP9GD4Vh' : 'qGuUgMMVmaCvqrvoWG6zARjkrujGMpzJmpNhBgz1y3RjBG7ZR'
};
