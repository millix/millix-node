import config from '../config/config';

export default {
    genesis_transaction: config.MODE_TEST_NETWORK ? '2SERbAUN61Rd8ZaqY5pus5wQ5pWaygxNL59tMXdsHMhLuL1nY2' : '2VngVznbdiQ5tqfWqn2NMP8DijqCbLX79Gygo9yYRVFU6iN35h',
    genesis_shard_id   : config.MODE_TEST_NETWORK ? '2LyepgyLzSvqY8ACgtMfiF1dBRPbYCeqR5nxNGrKet86zP3gnw' : 'qGuUgMMVmaCvqrvoWG6zARjkrujGMpzJmpNhBgz1y3RjBG7ZR'
};
