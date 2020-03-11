export const MODE_DEBUG                                = false;
export const MODE_TEST_NETWORK                         = false;
export const NODE_PORT                                 = MODE_TEST_NETWORK ? 30000 : 10000;
export const NODE_PORT_API                             = 5500;
export const NODE_HOST                                 = 'localhost';
export const WEBSOCKET_PROTOCOL                        = 'ws://';
export const RPC_INTERFACE                             = '0.0.0.0';
export const NODE_PUBLIC                               = false;
export const MODE_NODE_FULL                            = false;
export const NODE_INITIAL_LIST                         = MODE_TEST_NETWORK ?
                                                         [
                                                             'ws://13.251.31.129:30000',
                                                             'ws://13.251.31.129:30001',
                                                             'ws://52.74.179.232:30000',
                                                             'ws://52.74.179.232:30001'
                                                         ] :
                                                         [
                                                             'ws://18.136.162.158:10000',
                                                             'ws://18.136.162.158:10001',
                                                             'ws://18.138.163.22:10000',
                                                             'ws://18.138.163.22:10001',
                                                             'ws://3.0.29.177:10000',
                                                             'ws://3.0.29.177:10001'
                                                         ];
export const CONSENSUS_ROUND_NODE_COUNT                = 3;
export const CONSENSUS_ROUND_PATH_LENGTH_MIN           = 1;
export const CONSENSUS_ROUND_VALIDATION_REQUIRED       = 2;
export const CONSENSUS_ROUND_VALIDATION_MAX            = 5;
export const CONSENSUS_ROUND_NOT_FOUND_MAX             = 5;
export const CONSENSUS_ROUND_DOUBLE_SPEND_MAX          = 5;
export const CONSENSUS_VALIDATION_DEPTH_MAX            = 50;
export const CONSENSUS_VALIDATION_REQUEST_DEPTH_MAX    = 10000;
export const CONSENSUS_VALIDATION_WAIT_TIME_MAX        = 30 * 1000;
export const CONSENSUS_VALIDATION_RETRY_WAIT_TIME      = 10 * 1000;
export const AUDIT_POINT_NODE_COUNT                    = 3;
export const AUDIT_POINT_VALIDATION_REQUIRED           = 2;
export const AUDIT_POINT_ATTEMPT_MAX                   = 100;
export const AUDIT_POINT_CANDIDATE_MAX                 = 512;
export const AUDIT_POINT_VALIDATION_WAIT_TIME_MAX      = 60 * 1000;
export const AUDIT_POINT_PRUNE_AGE_MIN                 = 1440;
export const AUDIT_POINT_PRUNE_COUNT                   = 250;
export const AUDIT_POINT_TRANSACTION_PRUNE_AGE_MIN     = 1440;
export const AUDIT_POINT_TRANSACTION_PRUNE_COUNT       = 250;
export const NODE_CONNECTION_INBOUND_MAX               = 10;
export const NODE_CONNECTION_OUTBOUND_MAX              = 10;
export const HEARTBEAT_TIMEOUT                         = 10 * 1000;
export const HEARTBEAT_RESPONSE_TIMEOUT                = 60 * 1000;
export const WALLET_STARTUP_ADDRESS_BALANCE_SCAN_COUNT = 100;
export const WALLET_LOG_SIZE_MAX                       = 1000;
export const WALLET_TRANSACTION_DEFAULT_VERSION        = MODE_TEST_NETWORK ? 'lal' : '0a0';
export const WALLET_SPENT_TRANSACTION_PRUNE            = false;
export const WALLET_TRANSACTION_QUEUE_SIZE_MAX         = 1000;
export const WALLET_TRANSACTION_QUEUE_SIZE_NORMAL      = 250;
export const NETWORK_LONG_TIME_WAIT_MAX                = 3000;
export const NETWORK_SHORT_TIME_WAIT_MAX               = 1500;
export const DATABASE_ENGINE                           = 'sqlite';
export const DATABASE_CONNECTION                       = {};
export const MILLIX_CIRCULATION                        = 9e15;
export const MODE_TEST                                 = false;
export const NODE_TEST_HOST                            = '127.0.0.1';
export const NODE_TEST_PORT                            = 5080;
export const HASH_LENGTH                               = 44;
export const PUBKEY_LENGTH                             = 44;
export const SIG_LENGTH                                = 88;
export const NODE_MILLIX_VERSION                       = '0.0.1';

let DATA_BASE_DIR;
if (MODE_TEST_NETWORK) {
    DATA_BASE_DIR = './millix-testnet';
}
else {
    DATA_BASE_DIR = './millix';
}
export const NODE_KEY_PATH   = DATA_BASE_DIR + '/node.json';
export const KEY_PATH        = DATA_BASE_DIR + '/millix_private_key.json';
export const JOB_CONFIG_PATH = DATA_BASE_DIR + '/job.json';

if (DATABASE_ENGINE === 'sqlite') {
    DATABASE_CONNECTION.MAX_CONNECTIONS        = 1;
    DATABASE_CONNECTION.FOLDER                 = DATA_BASE_DIR + '/';
    DATABASE_CONNECTION.FILENAME_MILLIX        = 'millix.sqlite';
    DATABASE_CONNECTION.FILENAME_SYNC_QUEUE    = 'millix_sync_queue.sqlite';
    DATABASE_CONNECTION.FILENAME_JOB_ENGINE    = 'millix_job_engine.sqlite';
    DATABASE_CONNECTION.SCRIPT_INIT_MILLIX     = './scripts/initialize-millix-sqlite3.sql';
    DATABASE_CONNECTION.SCRIPT_INIT_JOB_ENGINE = './scripts/initialize-job-engine-sqlite3.sql';
    DATABASE_CONNECTION.SCRIPT_MIGRATION_DIR   = './scripts/migration';
    DATABASE_CONNECTION.SCHEMA_VERSION         = '1';
}

export default {
    MODE_DEBUG,
    MODE_TEST_NETWORK,
    NODE_PORT,
    NODE_HOST,
    WEBSOCKET_PROTOCOL,
    RPC_INTERFACE,
    NODE_INITIAL_LIST,
    NODE_CONNECTION_INBOUND_MAX,
    NODE_CONNECTION_OUTBOUND_MAX,
    NODE_PUBLIC,
    MODE_NODE_FULL,
    NODE_MILLIX_VERSION,
    MODE_TEST,
    NODE_TEST_HOST,
    NODE_KEY_PATH,
    DATABASE_ENGINE,
    DATABASE_CONNECTION,
    KEY_PATH,
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
    AUDIT_POINT_TRANSACTION_PRUNE_AGE_MIN,
    AUDIT_POINT_TRANSACTION_PRUNE_COUNT,
    AUDIT_POINT_PRUNE_AGE_MIN,
    AUDIT_POINT_PRUNE_COUNT,
    NETWORK_LONG_TIME_WAIT_MAX,
    NETWORK_SHORT_TIME_WAIT_MAX,
    WALLET_TRANSACTION_QUEUE_SIZE_MAX,
    WALLET_TRANSACTION_QUEUE_SIZE_NORMAL,
    WALLET_STARTUP_ADDRESS_BALANCE_SCAN_COUNT,
    WALLET_TRANSACTION_DEFAULT_VERSION,
    WALLET_SPENT_TRANSACTION_PRUNE,
    WALLET_LOG_SIZE_MAX,
    NODE_PORT_API,
    NODE_TEST_PORT,
    JOB_CONFIG_PATH
};
