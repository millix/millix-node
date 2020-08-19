export const MODE_DEBUG                                        = false;
export const MODE_TEST_NETWORK                                 = false;
export const NODE_PORT_MAIN_NETWORK                            = 10000;
export const NODE_PORT_TEST_NETWORK                            = 30000;
export const NODE_PORT                                         = MODE_TEST_NETWORK ? NODE_PORT_TEST_NETWORK : NODE_PORT_MAIN_NETWORK;
export const NODE_PORT_API                                     = 5500;
export const NODE_HOST                                         = 'localhost';
export const WEBSOCKET_PROTOCOL                                = 'wss://';
export const RPC_INTERFACE                                     = '0.0.0.0';
export const NODE_PUBLIC                                       = true;
export const MODE_NODE_FULL                                    = true;
export const NODE_INITIAL_LIST_MAIN_NETWORK                    = [
    {
        url     : 'wss://18.136.162.158:10000',
        port_api: 5500
    },
    {
        url     : 'wss://18.136.162.158:10001',
        port_api: 5500
    },
    {
        url     : 'wss://18.138.163.22:10000',
        port_api: 5500
    },
    {
        url     : 'wss://18.138.163.22:10001',
        port_api: 5500
    },
    {
        url     : 'wss://3.0.29.177:10000',
        port_api: 5500
    },
    {
        url     : 'wss://3.0.29.177:10001',
        port_api: 5500
    },
    {
        url     : 'wss://node0.millix.org:10000',
        port_api: 5500
    },
    {
        url     : 'wss://node1.millix.org:10000',
        port_api: 5500
    },
    {
        url     : 'wss://node2.millix.org:10000',
        port_api: 5500
    },
    {
        url     : 'wss://node3.millix.org:10000',
        port_api: 5500
    },
    {
        url     : 'wss://node4.millix.org:10000',
        port_api: 5500
    },
    {
        url     : 'wss://node5.millix.org:10000',
        port_api: 5500
    },
    {
        url     : 'wss://node6.millix.org:10000',
        port_api: 5500
    },
    {
        url     : 'wss://node7.millix.org:10000',
        port_api: 5500
    },
    {
        url     : 'wss://node8.millix.org:10000',
        port_api: 5500
    },
    {
        url     : 'wss://node9.millix.org:10000',
        port_api: 5500
    }
];
export const NODE_INITIAL_LIST_TEST_NETWORK                    = [
    {
        url     : 'wss://13.251.31.129:30000',
        port_api: 35500
    },
    {
        url     : 'wss://13.251.31.129:30001',
        port_api: 35501
    },
    {
        url     : 'wss://test-node0.millix.org:30000',
        port_api: 35500
    },
    {
        url     : 'wss://test-node1.millix.org:30000',
        port_api: 35500
    },
    {
        url     : 'wss://test-node2.millix.org:30000',
        port_api: 35500
    },
    {
        url     : 'wss://test-node3.millix.org:30000',
        port_api: 35500
    },
    {
        url     : 'wss://test-node4.millix.org:30000',
        port_api: 35500
    },
    {
        url     : 'wss://test-node5.millix.org:30000',
        port_api: 35500
    },
    {
        url     : 'wss://test-node6.millix.org:30000',
        port_api: 35500
    },
    {
        url     : 'wss://test-node7.millix.org:30000',
        port_api: 35500
    },
    {
        url     : 'wss://test-node8.millix.org:30000',
        port_api: 35500
    },
    {
        url     : 'wss://test-node9.millix.org:30000',
        port_api: 35500
    }
];
export const NODE_CONNECTION_INBOUND_WHITELIST                 = [];
export const NODE_CONNECTION_OUTBOUND_WHITELIST                = [];
export const NODE_CONNECTION_STATIC                            = [];
export const NODE_INITIAL_LIST                                 = MODE_TEST_NETWORK ? NODE_INITIAL_LIST_TEST_NETWORK : NODE_INITIAL_LIST_MAIN_NETWORK;
export const CONSENSUS_ROUND_NODE_COUNT                        = 3;
export const CONSENSUS_ROUND_PATH_LENGTH_MIN                   = 1;
export const CONSENSUS_ROUND_VALIDATION_REQUIRED               = 2;
export const CONSENSUS_ROUND_VALIDATION_MAX                    = 5;
export const CONSENSUS_ROUND_NOT_FOUND_MAX                     = 5;
export const CONSENSUS_ROUND_DOUBLE_SPEND_MAX                  = 5;
export const CONSENSUS_VALIDATION_DEPTH_MAX                    = 50;
export const CONSENSUS_VALIDATION_REQUEST_DEPTH_MAX            = 10000;
export const CONSENSUS_VALIDATION_WAIT_TIME_MAX                = 30 * 1000;
export const CONSENSUS_VALIDATION_RETRY_WAIT_TIME              = 10 * 1000;
export const AUDIT_POINT_NODE_COUNT                            = 3;
export const AUDIT_POINT_VALIDATION_REQUIRED                   = 2;
export const AUDIT_POINT_ATTEMPT_MAX                           = 100;
export const AUDIT_POINT_CANDIDATE_MAX                         = 512;
export const AUDIT_POINT_VALIDATION_WAIT_TIME_MAX              = 60 * 1000;
export const AUDIT_POINT_PRUNE_AGE_MIN                         = 1440;
export const AUDIT_POINT_PRUNE_COUNT                           = 250;
export const TRANSACTION_PRUNE_AGE_MIN                         = 1440;
export const TRANSACTION_PRUNE_COUNT                           = 1000;
export const TRANSACTION_RETRY_SYNC_MAX                        = 100;
export const TRANSACTION_PROGRESSIVE_SYNC_TIMESPAN             = 3600;
export const TRANSACTION_OUTPUT_REFRESH_OLDER_THAN             = 4200;
export const TRANSACTION_OUTPUT_EXPIRE_OLDER_THAN              = 4320;
export const NODE_CONNECTION_INBOUND_MAX                       = 10;
export const NODE_CONNECTION_OUTBOUND_MAX                      = 10;
export const HEARTBEAT_TIMEOUT                                 = 10 * 1000;
export const HEARTBEAT_RESPONSE_TIMEOUT                        = 60 * 1000;
export const WALLET_STARTUP_ADDRESS_BALANCE_SCAN_COUNT         = 100;
export const WALLET_LOG_SIZE_MAX                               = 1000;
export const WALLET_TRANSACTION_DEFAULT_VERSION_MAIN_NETWORK   = '0a0';
export const WALLET_TRANSACTION_DEFAULT_VERSION_TEST_NETWORK   = 'la0l';
export const WALLET_TRANSACTION_DEFAULT_VERSION                = MODE_TEST_NETWORK ? WALLET_TRANSACTION_DEFAULT_VERSION_MAIN_NETWORK : WALLET_TRANSACTION_DEFAULT_VERSION_TEST_NETWORK;
export const WALLET_TRANSACTION_REFRESH_VERSION_MAIN_NETWORK   = '0b0';
export const WALLET_TRANSACTION_REFRESH_VERSION_TEST_NETWORK   = 'lb0l';
export const WALLET_TRANSACTION_REFRESH_VERSION                = MODE_TEST_NETWORK ? WALLET_TRANSACTION_REFRESH_VERSION_TEST_NETWORK : WALLET_TRANSACTION_REFRESH_VERSION_MAIN_NETWORK;
export const WALLET_TRANSACTION_SUPPORTED_VERSION_MAIN_NETWORK = [
    '0a0',
    '0b0'
];
export const WALLET_TRANSACTION_SUPPORTED_VERSION_TEST_NETWORK = [
    'la0l',
    'lb0l'
];
export const WALLET_TRANSACTION_SUPPORTED_VERSION              = MODE_TEST_NETWORK ? WALLET_TRANSACTION_SUPPORTED_VERSION_TEST_NETWORK : WALLET_TRANSACTION_SUPPORTED_VERSION_MAIN_NETWORK;
export const WALLET_SPENT_TRANSACTION_PRUNE                    = false;
export const WALLET_TRANSACTION_QUEUE_SIZE_MAX                 = 1000;
export const WALLET_TRANSACTION_QUEUE_SIZE_NORMAL              = 250;
export const NETWORK_LONG_TIME_WAIT_MAX                        = 3000;
export const NETWORK_SHORT_TIME_WAIT_MAX                       = 1500;
export const DATABASE_ENGINE                                   = 'sqlite';
export const DATABASE_CONNECTION                               = {};
export const MILLIX_CIRCULATION                                = 9e15;
export const MODE_TEST                                         = false;
export const NODE_TEST_HOST                                    = '127.0.0.1';
export const NODE_TEST_PORT                                    = 5080;
export const HASH_LENGTH                                       = 44;
export const PUBKEY_LENGTH                                     = 44;
export const SIG_LENGTH                                        = 88;
export const NODE_MILLIX_VERSION                               = '1.6.3';
export const DATA_BASE_DIR_MAIN_NETWORK                        = './millix';
export const DATA_BASE_DIR_TEST_NETWORK                        = './millix-testnet';
let DATA_BASE_DIR                                              = MODE_TEST_NETWORK ? DATA_BASE_DIR_TEST_NETWORK : DATA_BASE_DIR_MAIN_NETWORK;
export const NODE_KEY_PATH                                     = DATA_BASE_DIR + '/node.json';
export const NODE_CERTIFICATE_KEY_PATH                         = DATA_BASE_DIR + '/node_certificate_key.pem';
export const NODE_CERTIFICATE_PATH                             = DATA_BASE_DIR + '/node_certificate.pem';
export const WALLET_KEY_PATH                                   = DATA_BASE_DIR + '/millix_private_key.json';
export const JOB_CONFIG_PATH                                   = DATA_BASE_DIR + '/job.json';
export const JOB_CONFIG_VERSION                                = 1;
export const SHARD_ZERO_NAME                                   = 'shard_zero';
export const PEER_ROTATION_MORE_THAN_AVERAGE                   = 0.5;
export const PEER_ROTATION_MORE_THAN_MOST                      = 0.2;
export const PEER_ROTATION_MORE_THAN_ALL                       = 0.01;
export const PEER_ROTATION_CONFIG                              = {
    'PROACTIVE': {
        'frequency'    : 0.7,
        'DATA_QUANTITY': {
            'frequency'        : 0.25,
            'random_set_length': 'PEER_ROTATION_MORE_THAN_AVERAGE'
        },
        'POPULARITY'   : {
            'frequency'        : 0.25,
            'random_set_length': 'PEER_ROTATION_MORE_THAN_AVERAGE'
        },
        'RANDOM'       : {'frequency': 0.5}
    },
    'REACTIVE' : {'frequency': 0.3}
};

if (DATABASE_ENGINE === 'sqlite') {
    DATABASE_CONNECTION.MAX_CONNECTIONS                  = 1;
    DATABASE_CONNECTION.FOLDER                           = DATA_BASE_DIR + '/';
    DATABASE_CONNECTION.FILENAME_MILLIX                  = 'millix.sqlite';
    DATABASE_CONNECTION.FILENAME_TRANSACTION_QUEUE       = 'millix_transaction_queue.sqlite';
    DATABASE_CONNECTION.FILENAME_TRANSACTION_SPEND_QUEUE = 'millix_transaction_spend_queue.sqlite';
    DATABASE_CONNECTION.FILENAME_JOB_ENGINE              = 'millix_job_engine.sqlite';
    DATABASE_CONNECTION.SCRIPT_INIT_MILLIX               = './scripts/initialize-millix-sqlite3.sql';
    DATABASE_CONNECTION.SCRIPT_INIT_MILLIX_SHARD         = './scripts/initialize-millix-shard-sqlite3.sql';
    DATABASE_CONNECTION.SCRIPT_INIT_MILLIX_JOB_ENGINE    = './scripts/initialize-millix-job-engine-sqlite3.sql';
    DATABASE_CONNECTION.SCRIPT_MIGRATION_DIR             = './scripts/migration';
    DATABASE_CONNECTION.SCRIPT_MIGRATION_SHARD_DIR       = './scripts/migration/shard';
    DATABASE_CONNECTION.SCHEMA_VERSION                   = '8';
}

export default {
    MODE_DEBUG,
    MODE_TEST_NETWORK,
    NODE_PORT,
    NODE_HOST,
    WEBSOCKET_PROTOCOL,
    RPC_INTERFACE,
    NODE_INITIAL_LIST,
    NODE_CONNECTION_STATIC,
    NODE_CONNECTION_INBOUND_MAX,
    NODE_CONNECTION_OUTBOUND_MAX,
    NODE_CONNECTION_INBOUND_WHITELIST,
    NODE_CONNECTION_OUTBOUND_WHITELIST,
    NODE_PUBLIC,
    NODE_MILLIX_VERSION,
    MODE_TEST,
    NODE_TEST_HOST,
    NODE_KEY_PATH,
    NODE_PORT_API,
    NODE_TEST_PORT,
    NODE_CERTIFICATE_KEY_PATH,
    NODE_CERTIFICATE_PATH,
    DATABASE_ENGINE,
    DATABASE_CONNECTION,
    WALLET_KEY_PATH,
    MILLIX_CIRCULATION,
    CONSENSUS_ROUND_PATH_LENGTH_MIN,
    CONSENSUS_VALIDATION_DEPTH_MAX,
    CONSENSUS_VALIDATION_REQUEST_DEPTH_MAX,
    CONSENSUS_ROUND_VALIDATION_MAX,
    CONSENSUS_ROUND_VALIDATION_REQUIRED,
    CONSENSUS_ROUND_DOUBLE_SPEND_MAX,
    CONSENSUS_ROUND_NOT_FOUND_MAX,
    CONSENSUS_VALIDATION_WAIT_TIME_MAX,
    CONSENSUS_VALIDATION_RETRY_WAIT_TIME,
    CONSENSUS_ROUND_NODE_COUNT,
    AUDIT_POINT_NODE_COUNT,
    AUDIT_POINT_VALIDATION_REQUIRED,
    AUDIT_POINT_ATTEMPT_MAX,
    AUDIT_POINT_CANDIDATE_MAX,
    AUDIT_POINT_VALIDATION_WAIT_TIME_MAX,
    TRANSACTION_PRUNE_AGE_MIN,
    TRANSACTION_PRUNE_COUNT,
    TRANSACTION_RETRY_SYNC_MAX,
    TRANSACTION_PROGRESSIVE_SYNC_TIMESPAN,
    TRANSACTION_OUTPUT_REFRESH_OLDER_THAN,
    TRANSACTION_OUTPUT_EXPIRE_OLDER_THAN,
    AUDIT_POINT_PRUNE_AGE_MIN,
    AUDIT_POINT_PRUNE_COUNT,
    NETWORK_LONG_TIME_WAIT_MAX,
    NETWORK_SHORT_TIME_WAIT_MAX,
    WALLET_TRANSACTION_QUEUE_SIZE_MAX,
    WALLET_TRANSACTION_QUEUE_SIZE_NORMAL,
    WALLET_STARTUP_ADDRESS_BALANCE_SCAN_COUNT,
    WALLET_TRANSACTION_SUPPORTED_VERSION,
    WALLET_TRANSACTION_DEFAULT_VERSION,
    WALLET_TRANSACTION_REFRESH_VERSION,
    WALLET_SPENT_TRANSACTION_PRUNE,
    WALLET_LOG_SIZE_MAX,
    PEER_ROTATION_MORE_THAN_AVERAGE,
    PEER_ROTATION_MORE_THAN_MOST,
    PEER_ROTATION_MORE_THAN_ALL,
    PEER_ROTATION_CONFIG,
    JOB_CONFIG_PATH,
    JOB_CONFIG_VERSION
};
