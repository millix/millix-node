const const_value_default = {
    'MODE_DEBUG'                : false,
    'MODE_TEST_NETWORK'         : false,
    'NODE_MILLIX_BUILD_DATE'    : 1769118031,
    'NODE_MILLIX_VERSION'       : '1.26.0',
    'DATA_BASE_DIR_MAIN_NETWORK': './millix',
    'DATA_BASE_DIR_TEST_NETWORK': './millix-testnet',
    'DEBUG_LOG_FILTER'          : [],

    'NODE_PORT_STORAGE_RECEIVER_TEST_NETWORK': 6000,
    'NODE_PORT_STORAGE_RECEIVER_MAIN_NETWORK': 8000,
    'NODE_PORT_STORAGE_PROVIDER_TEST_NETWORK': 6001,
    'NODE_PORT_STORAGE_PROVIDER_MAIN_NETWORK': 8001,

    'MODE_NODE_SYNC_FULL': false,

    'EXTERNAL_API_NOTIFICATION': null,

    'CONSENSUS_ROUND_NODE_COUNT'         : 12,
    'CONSENSUS_ROUND_VALIDATION_REQUIRED': 3,
    'CONSENSUS_ROUND_VALIDATION_MAX'     : 3,
    'CONSENSUS_ROUND_NOT_FOUND_MAX'      : 3,
    'CONSENSUS_ROUND_DOUBLE_SPEND_MAX'   : 3,

    'CONSENSUS_VALIDATION_WAIT_TIME_MAX': 15 * 1000,
    'CONSENSUS_WATCHDOG_WAIT_TIME_MAX'  : 60 * 1000,

    'MODE_VPN_EXIT'              : false,
    'VPN_RECEIPT_INTERVAL_BYTES' : 1024 * 1024,
    'VPN_RECEIPT_GAP_BYTES_MAX'  : 50 * 1024 * 1024,
    'VPN_SESSION_IDLE_TIME_MAX'  : 30 * 60 * 1000,
    'VPN_SESSION_MAX'            : 32,
    'VPN_ESCROW_PORTION_BYTES'   : 10 * 1024 * 1024,
    'VPN_ESCROW_PORTION_AMOUNT'  : 1465, // 150,000 millix per GB, the prototype's pool rate
    'VPN_ESCROW_UNLOCK_REMAINING_MIN': 60 * 60,

    'ESCROW_CLAIM_AMOUNT_MIN'   : 10000,
    'ESCROW_CLAIM_BEFORE_UNLOCK': 30 * 60,
    // null: the network's default below
    'ESCROW_ACTIVATION_DATE'    : null,

    // the public key of tangled's key that signs the minimum version for
    // cloud features (net/cloud-version.js). null: the network's default
    // below
    'CLOUD_AUTHORITY_PUBLIC_KEY': null,

    // brokers (net/broker/broker.js). CLOUD_BROKER_LIST holds the brokers
    // this node knows as {address, public_key}; the first one sells this
    // node its passes. tangled's broker is to be added before release.
    'MODE_CLOUD_BROKER'               : false,
    'CLOUD_BROKER_LIST'               : [],
    'CLOUD_BROKER_PASS_PRICE'         : 5000000,
    'CLOUD_BROKER_PASS_DATA_BYTES'    : 25 * 1024 * 1024 * 1024,
    'CLOUD_BROKER_PASS_PIECE_BYTES'   : 1024 * 1024 * 1024,
    'CLOUD_BROKER_PASS_DURATION'      : 7 * 24 * 60 * 60,
    'CLOUD_BROKER_POOL_RATE'          : 150000, // millix per GB paid to exit nodes
    'CLOUD_BROKER_PAYOUT_INTERVAL'    : 60 * 60,
    'CLOUD_BROKER_PAYOUT_AMOUNT_MIN'  : 10000,
    'CLOUD_BROKER_REPORT_INTERVAL'    : 5 * 60,
    'CLOUD_PASS_PAYMENT_WAIT_TIME_MAX': 10 * 60
};

let environment;
try {
    environment = require('./environment');
    environment = environment.default;
}
catch (ex) {
}

function getConstValue(const_name) {
    if (!Object.keys(const_value_default).includes(const_name)) {
        throw 'const_value_default is not defined for ' + const_name;
    }

    let value = const_value_default[const_name];
    if (environment && typeof (environment[const_name]) !== 'undefined') {
        value = environment[const_name];
    }

    return value;
}


export const MODE_DEBUG                                        = getConstValue('MODE_DEBUG');
export const MODE_TEST_NETWORK                                 = getConstValue('MODE_TEST_NETWORK');
export const NODE_DNS_SERVER                                   = [
    '1.1.1.1',
    '8.8.8.8'
];
export const NODE_PORT_MAIN_NETWORK                            = 10000;
export const NODE_PORT_TEST_NETWORK                            = 30000;
export const NODE_PORT_DISCOVERY_TEST_NETWORK                  = 4000;
export const NODE_PORT_DISCOVERY_MAIN_NETWORK                  = 2000;
export const NODE_PORT_STORAGE_RECEIVER_TEST_NETWORK           = getConstValue('NODE_PORT_STORAGE_RECEIVER_TEST_NETWORK');
export const NODE_PORT_STORAGE_RECEIVER_MAIN_NETWORK           = getConstValue('NODE_PORT_STORAGE_RECEIVER_MAIN_NETWORK');
export const NODE_PORT_STORAGE_PROVIDER_TEST_NETWORK           = getConstValue('NODE_PORT_STORAGE_PROVIDER_TEST_NETWORK');
export const NODE_PORT_STORAGE_PROVIDER_MAIN_NETWORK           = getConstValue('NODE_PORT_STORAGE_PROVIDER_MAIN_NETWORK');
export const NODE_PORT_STORAGE_RECEIVER                        = MODE_TEST_NETWORK ? NODE_PORT_STORAGE_RECEIVER_TEST_NETWORK : NODE_PORT_STORAGE_RECEIVER_MAIN_NETWORK;
export const NODE_PORT_STORAGE_PROVIDER                        = MODE_TEST_NETWORK ? NODE_PORT_STORAGE_PROVIDER_TEST_NETWORK : NODE_PORT_STORAGE_PROVIDER_MAIN_NETWORK;
export const NODE_PORT_DISCOVERY                               = MODE_TEST_NETWORK ? NODE_PORT_DISCOVERY_TEST_NETWORK : NODE_PORT_DISCOVERY_MAIN_NETWORK;
export const NODE_PORT                                         = MODE_TEST_NETWORK ? NODE_PORT_TEST_NETWORK : NODE_PORT_MAIN_NETWORK;
export const NODE_PORT_API                                     = 5500;
export const NODE_PORT_VPN_MAIN_NETWORK                        = 10005;
export const NODE_PORT_VPN_TEST_NETWORK                        = 30005;
export const NODE_PORT_VPN                                     = MODE_TEST_NETWORK ? NODE_PORT_VPN_TEST_NETWORK : NODE_PORT_VPN_MAIN_NETWORK;
export const NODE_PORT_BROKER_MAIN_NETWORK                     = 10006;
export const NODE_PORT_BROKER_TEST_NETWORK                     = 30006;
export const NODE_PORT_BROKER                                  = MODE_TEST_NETWORK ? NODE_PORT_BROKER_TEST_NETWORK : NODE_PORT_BROKER_MAIN_NETWORK;
export const NODE_HOST                                         = 'localhost';
export const NODE_HOST_FORCE                                   = false;
export const NODE_BIND_IP                                      = '0.0.0.0';
export const NODE_NAT_PMP                                      = true;
export const NODE_NAT_PMP_CHECK                                = true;
export const NODE_STORAGE_PORT_CHECK                           = false;
export const WEBSOCKET_PROTOCOL                                = 'wss://';
export const RPC_INTERFACE                                     = '0.0.0.0';
export const ACTIVE_LANGUAGE_GUID                              = 'BEpDwgG53';
export const NODE_PUBLIC                                       = undefined;
export const MODE_NODE_VALIDATION_FULL                         = true;
export const MODE_NODE_SYNC_FULL                               = getConstValue('MODE_NODE_SYNC_FULL');
export const MODE_STORAGE_SYNC                                 = true;
export const MODE_STORAGE_SYNC_FULL                            = false;
export const FORCE_QUEUE_UPDATE                                = false;
export const EXTERNAL_WALLET_KEY_IDENTIFIER                    = [];
export const EXTERNAL_API_NOTIFICATION                         = getConstValue('EXTERNAL_API_NOTIFICATION');
export const NODE_INITIAL_LIST_MAIN_NETWORK                    = [
    {
        host          : '18.136.162.158',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : '18.136.162.158',
        port_protocol : 10001,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00001.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00002.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00003.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00004.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00005.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00006.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00007.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00008.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00009.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00010.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00011.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00012.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00013.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00014.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00015.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00016.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00017.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00018.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00019.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00020.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00021.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00022.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00023.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00024.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00025.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00026.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00027.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00028.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00029.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00030.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00031.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00032.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00033.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00034.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00035.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00036.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00037.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00038.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00039.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00040.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00041.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00042.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00043.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00044.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00045.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00046.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00047.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00048.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00049.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00050.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00051.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00052.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00053.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00054.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00055.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00056.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00057.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00058.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00059.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00060.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00061.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00062.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00063.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00064.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00065.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00066.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00067.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00068.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00069.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00070.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00071.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00072.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00073.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00074.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00075.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00076.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00077.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00078.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00079.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00080.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00081.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00082.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00083.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00084.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00085.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00086.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00087.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00088.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00089.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00090.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00091.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00092.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00093.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00094.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00095.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00096.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00097.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00098.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00099.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    },
    {
        host          : 'node-00100.millix.com',
        port_protocol : 10000,
        port_api      : 5500,
        port_discovery: 2000
    }
];
export const NODE_INITIAL_LIST_TEST_NETWORK                    = [
    {
        host          : '13.251.31.129',
        port_protocol : 30000,
        port_api      : 5500,
        port_discovery: 4000
    },
    {
        host          : '13.251.31.129',
        port_protocol : 30001,
        port_api      : 5500,
        port_discovery: 4000
    },
    {
        host          : 'test-node-00001.millix.com',
        port_protocol : 30000,
        port_api      : 5500,
        port_discovery: 4000
    },
    {
        host          : 'test-node-00002.millix.com',
        port_protocol : 30000,
        port_api      : 5500,
        port_discovery: 4000
    },
    {
        host          : 'test-node-00003.millix.com',
        port_protocol : 30000,
        port_api      : 5500,
        port_discovery: 4000
    },
    {
        host          : 'test-node-00004.millix.com',
        port_protocol : 30000,
        port_api      : 5500,
        port_discovery: 4000
    },
    {
        host          : 'test-node-00005.millix.com',
        port_protocol : 30000,
        port_api      : 5500,
        port_discovery: 4000
    },
    {
        host          : 'test-node-00006.millix.com',
        port_protocol : 30000,
        port_api      : 5500,
        port_discovery: 4000
    },
    {
        host          : 'test-node-00007.millix.com',
        port_protocol : 30000,
        port_api      : 5500,
        port_discovery: 4000
    },
    {
        host          : 'test-node-00008.millix.com',
        port_protocol : 30000,
        port_api      : 5500,
        port_discovery: 4000
    },
    {
        host          : 'test-node-00009.millix.com',
        port_protocol : 30000,
        port_api      : 5500,
        port_discovery: 4000
    },
    {
        host          : 'test-node-00010.millix.com',
        port_protocol : 30000,
        port_api      : 5500,
        port_discovery: 4000
    }
];
export const NODE_CONNECTION_INBOUND_WHITELIST                 = [];
export const NODE_CONNECTION_OUTBOUND_WHITELIST                = [];
export const NODE_CONNECTION_STATIC                            = [];
export const NODE_INITIAL_LIST                                 = MODE_TEST_NETWORK ? NODE_INITIAL_LIST_TEST_NETWORK : NODE_INITIAL_LIST_MAIN_NETWORK;
export const CONSENSUS_ROUND_NODE_COUNT                        = getConstValue('CONSENSUS_ROUND_NODE_COUNT');
export const CONSENSUS_ROUND_VALIDATION_REQUIRED               = getConstValue('CONSENSUS_ROUND_VALIDATION_REQUIRED');
export const CONSENSUS_ROUND_VALIDATION_MAX                    = getConstValue('CONSENSUS_ROUND_VALIDATION_MAX');
export const CONSENSUS_ROUND_NOT_FOUND_MAX                     = getConstValue('CONSENSUS_ROUND_NOT_FOUND_MAX');
export const CONSENSUS_ROUND_DOUBLE_SPEND_MAX                  = getConstValue('CONSENSUS_ROUND_DOUBLE_SPEND_MAX');
export const CONSENSUS_VALIDATION_DEPTH_MAX                    = 50;
export const CONSENSUS_VALIDATION_REQUEST_DEPTH_MAX            = 100;
export const CONSENSUS_VALIDATION_WAIT_TIME_MAX                = getConstValue('CONSENSUS_VALIDATION_WAIT_TIME_MAX');
export const CONSENSUS_WATCHDOG_WAIT_TIME_MAX                  = getConstValue('CONSENSUS_WATCHDOG_WAIT_TIME_MAX');
export const CONSENSUS_VALIDATION_RETRY_WAIT_TIME              = 10 * 1000;
export const CONSENSUS_VALIDATION_PARALLEL_PROCESS_MAX         = 2;
export const CONSENSUS_VALIDATION_PARALLEL_REQUEST_MAX         = 2;
export const CONSENSUS_VALIDATION_INPUT_TRANSACTION_RESET      = true;
export const TRANSACTION_TIME_LIMIT_PROXY                      = 5000;
export const TRANSACTION_FEE_PROXY                             = 1000;
export const TRANSACTION_FEE_DEFAULT                           = 1000;
export const TRANSACTION_FEE_NETWORK                           = 0.0;
export const TRANSACTION_PRUNE_AGE_MIN                         = 10;
export const TRANSACTION_PRUNE_COUNT                           = 1000;
export const TRANSACTION_RETRY_SYNC_MAX                        = 100;
export const TRANSACTION_INPUT_MAX                             = 128;
export const TRANSACTION_OUTPUT_MAX                            = 128;
export const TRANSACTION_PARENT_MAX                            = 16;
export const TRANSACTION_SIGNATURE_MAX                         = 128;
export const TRANSACTION_CLOCK_SKEW_TOLERANCE                  = 10;
export const TRANSACTION_PROGRESSIVE_SYNC_TIMESPAN             = 60;
export const TRANSACTION_OUTPUT_REFRESH_OLDER_THAN             = 10;
export const TRANSACTION_OUTPUT_EXPIRE_OLDER_THAN              = 10;
export const NODE_CONNECTION_INBOUND_MAX                       = 60;
export const NODE_CONNECTION_OUTBOUND_MAX                      = 60;
export const NODE_CONNECTION_PUBLIC_PERCENT                    = 0.2;
export const CLOUD_OFFER_SERVICE_LIST                          = [
    'vpn_exit',
    'storage_host',
    'broker'
];
// tangled's public key for the minimum version message. to be filled in by
// tangled before release: while it is null no message is accepted and the
// minimum stays CLOUD_NODE_VERSION_MIN.
export const CLOUD_AUTHORITY_PUBLIC_KEY_MAIN_NETWORK           = null;
export const CLOUD_AUTHORITY_PUBLIC_KEY_TEST_NETWORK           = null;
export const CLOUD_AUTHORITY_PUBLIC_KEY                        = getConstValue('CLOUD_AUTHORITY_PUBLIC_KEY') ?? (MODE_TEST_NETWORK ? CLOUD_AUTHORITY_PUBLIC_KEY_TEST_NETWORK : CLOUD_AUTHORITY_PUBLIC_KEY_MAIN_NETWORK);
// the minimum version for cloud features until a signed message raises it
export const CLOUD_NODE_VERSION_MIN                            = '1.26.0';
export const CLOUD_OFFER_DURATION_MAX                          = 7 * 24 * 60 * 60;
export const CLOUD_OFFER_CLOCK_SKEW_TOLERANCE                  = 60;
export const CLOUD_OFFER_BROKER_MAX                            = 16;
export const CLOUD_OFFER_SIZE_MAX                              = 4096;
export const CLOUD_OFFER_LIST_SIZE_MAX                         = 100;
export const CLOUD_OFFER_PRUNE_WAIT_TIME                       = 60 * 1000;
// escrow transactions are valid from this transaction date on. nodes from
// ESCROW_NODE_VERSION_MIN on know the escrow rules: after activation an
// escrow transaction is only proxied, validated and propagated through them.
export const ESCROW_ACTIVATION_DATE_MAIN_NETWORK               = 1798761600; // 2027-01-01 00:00 utc
export const ESCROW_ACTIVATION_DATE_TEST_NETWORK               = 1796083200; // 2026-12-01 00:00 utc
export const ESCROW_ACTIVATION_DATE                            = getConstValue('ESCROW_ACTIVATION_DATE') ?? (MODE_TEST_NETWORK ? ESCROW_ACTIVATION_DATE_TEST_NETWORK : ESCROW_ACTIVATION_DATE_MAIN_NETWORK);
export const ESCROW_NODE_VERSION_MIN                           = '1.26.0';
export const ESCROW_TERMS_VERSION                              = 1;
export const MODE_CLOUD_BROKER                                 = getConstValue('MODE_CLOUD_BROKER');
export const CLOUD_BROKER_LIST                                 = getConstValue('CLOUD_BROKER_LIST');
export const CLOUD_BROKER_PASS_PRICE                           = getConstValue('CLOUD_BROKER_PASS_PRICE');
export const CLOUD_BROKER_PASS_DATA_BYTES                      = getConstValue('CLOUD_BROKER_PASS_DATA_BYTES');
export const CLOUD_BROKER_PASS_PIECE_BYTES                     = getConstValue('CLOUD_BROKER_PASS_PIECE_BYTES');
export const CLOUD_BROKER_PASS_DURATION                        = getConstValue('CLOUD_BROKER_PASS_DURATION');
export const CLOUD_BROKER_POOL_RATE                            = getConstValue('CLOUD_BROKER_POOL_RATE');
export const CLOUD_BROKER_PAYOUT_INTERVAL                      = getConstValue('CLOUD_BROKER_PAYOUT_INTERVAL');
export const CLOUD_BROKER_PAYOUT_AMOUNT_MIN                    = getConstValue('CLOUD_BROKER_PAYOUT_AMOUNT_MIN');
export const CLOUD_BROKER_REPORT_INTERVAL                      = getConstValue('CLOUD_BROKER_REPORT_INTERVAL');
export const CLOUD_PASS_PAYMENT_WAIT_TIME_MAX                  = getConstValue('CLOUD_PASS_PAYMENT_WAIT_TIME_MAX');
// one payout transaction pays up to 126 exit nodes: 127 outputs and the fee
export const CLOUD_BROKER_PAYOUT_OUTPUT_MAX                    = TRANSACTION_OUTPUT_MAX - 1;
export const CLOUD_BROKER_REPORT_RECEIPT_MAX                   = 100;
export const CLOUD_PASS_PIECE_COUNT_MAX                        = 1000;
export const CLOUD_PASS_DURATION_MAX                           = 31 * 24 * 60 * 60;
export const ESCROW_RECEIPT_VERSION                            = 1;
export const ESCROW_PORTION_BYTES_MIN                          = 1024;
export const ESCROW_UNLOCK_DURATION_MAX                        = 30 * 24 * 60 * 60;
export const ESCROW_TASK_WAIT_TIME                             = 60 * 1000;
export const ESCROW_CLAIM_AMOUNT_MIN                           = getConstValue('ESCROW_CLAIM_AMOUNT_MIN');
export const ESCROW_CLAIM_BEFORE_UNLOCK                        = getConstValue('ESCROW_CLAIM_BEFORE_UNLOCK');
export const MODE_VPN_EXIT                                     = getConstValue('MODE_VPN_EXIT');
export const VPN_RECEIPT_INTERVAL_BYTES                        = getConstValue('VPN_RECEIPT_INTERVAL_BYTES');
export const VPN_RECEIPT_GAP_BYTES_MAX                         = getConstValue('VPN_RECEIPT_GAP_BYTES_MAX');
export const VPN_SESSION_IDLE_TIME_MAX                         = getConstValue('VPN_SESSION_IDLE_TIME_MAX');
export const VPN_SESSION_MAX                                   = getConstValue('VPN_SESSION_MAX');
export const VPN_ESCROW_PORTION_BYTES                          = getConstValue('VPN_ESCROW_PORTION_BYTES');
export const VPN_ESCROW_PORTION_AMOUNT                         = getConstValue('VPN_ESCROW_PORTION_AMOUNT');
export const VPN_ESCROW_UNLOCK_REMAINING_MIN                   = getConstValue('VPN_ESCROW_UNLOCK_REMAINING_MIN');
export const VPN_ALLOWED_PORT_LIST                             = [443];
export const VPN_AUTH_WAIT_TIME_MAX                            = 60 * 1000;
export const HEARTBEAT_TIMEOUT                                 = 10 * 1000;
export const HEARTBEAT_RESPONSE_TIMEOUT                        = 60 * 1000;
export const WALLET_STARTUP_ADDRESS_BALANCE_SCAN_COUNT         = 100;
export const WALLET_LOG_SIZE_MAX                               = 1000;
export const WALLET_ADDRESS_GENERATE_MAX                       = 10000;
export const WALLET_TRANSACTION_DEFAULT_VERSION_MAIN_NETWORK   = '0a20';
export const WALLET_TRANSACTION_DEFAULT_VERSION_TEST_NETWORK   = 'la2l';
export const WALLET_TRANSACTION_DEFAULT_VERSION                = MODE_TEST_NETWORK ? WALLET_TRANSACTION_DEFAULT_VERSION_TEST_NETWORK : WALLET_TRANSACTION_DEFAULT_VERSION_MAIN_NETWORK;
export const WALLET_TRANSACTION_REFRESH_VERSION_MAIN_NETWORK   = '0b20';
export const WALLET_TRANSACTION_REFRESH_VERSION_TEST_NETWORK   = 'lb2l';
export const WALLET_TRANSACTION_REFRESH_VERSION                = MODE_TEST_NETWORK ? WALLET_TRANSACTION_REFRESH_VERSION_TEST_NETWORK : WALLET_TRANSACTION_REFRESH_VERSION_MAIN_NETWORK;
export const BRIDGE_ADDRESS_MAIN_NETWORK                       = '18YiYXcKg9cCgKXRWvSc7oELZcN5XwuLQ70d018YiYXcKg9cCgKXRWvSc7oELZcN5XwuLQ7';
export const BRIDGE_ADDRESS_TEST_NETWORK                       = 'mrjwGXkksrfwAzwwa3KgdH9acv7ZND5xc9ldlmrjwGXkksrfwAzwwa3KgdH9acv7ZND5xc9';
export const BRIDGE_ADDRESS                                    = MODE_TEST_NETWORK ? BRIDGE_ADDRESS_TEST_NETWORK : BRIDGE_ADDRESS_MAIN_NETWORK;
export const BRIDGE_TRANSACTION_VERSION_MINT_MAIN_NETWORK      = '0a40';
export const BRIDGE_TRANSACTION_VERSION_MINT_TEST_NETWORK      = 'la4l';
export const BRIDGE_TRANSACTION_VERSION_BURN_MAIN_NETWORK      = '0a50';
export const BRIDGE_TRANSACTION_VERSION_BURN_TEST_NETWORK      = 'la5l';
export const BRIDGE_TRANSACTION_VERSION_MINT                   = MODE_TEST_NETWORK ? BRIDGE_TRANSACTION_VERSION_MINT_TEST_NETWORK : BRIDGE_TRANSACTION_VERSION_MINT_MAIN_NETWORK;
export const BRIDGE_TRANSACTION_VERSION_BURN                   = MODE_TEST_NETWORK ? BRIDGE_TRANSACTION_VERSION_BURN_TEST_NETWORK : BRIDGE_TRANSACTION_VERSION_BURN_MAIN_NETWORK;
export const ADDRESS_VERSION_BRIDGE_MAIN_NETWORK               = '0d0';
export const ADDRESS_VERSION_BRIDGE_TEST_NETWORK               = 'ldl';
export const ADDRESS_VERSION_BRIDGE                            = MODE_TEST_NETWORK ? ADDRESS_VERSION_BRIDGE_TEST_NETWORK : ADDRESS_VERSION_BRIDGE_MAIN_NETWORK;
export const ADDRESS_VERSION_NFT_MAIN_NETWORK                  = '0c0';
export const ADDRESS_VERSION_NFT_TEST_NETWORK                  = 'lcl';
export const ADDRESS_VERSION_NFT                               = MODE_TEST_NETWORK ? ADDRESS_VERSION_NFT_TEST_NETWORK : ADDRESS_VERSION_NFT_MAIN_NETWORK;
export const ADDRESS_VERSION_ESCROW_MAIN_NETWORK               = '0e0';
export const ADDRESS_VERSION_ESCROW_TEST_NETWORK               = 'lel';
export const ADDRESS_VERSION_ESCROW                            = MODE_TEST_NETWORK ? ADDRESS_VERSION_ESCROW_TEST_NETWORK : ADDRESS_VERSION_ESCROW_MAIN_NETWORK;
export const WALLET_TRANSACTION_SUPPORTED_VERSION_MAIN_NETWORK = [
    '0a0',
    '0b0',
    '0a10',
    '0b10',
    '0a20',
    '0b20',
    '0a30', // transaction with data
    '0b30',
    '0a40', // bridge mint
    '0b40',
    '0a50', // bridge burn
    '0b50'
];
export const WALLET_TRANSACTION_SUPPORTED_VERSION_TEST_NETWORK = [
    'la0l',
    'lb0l',
    'la1l',
    'lb1l',
    'la2l',
    'lb2l',
    'la3l',
    'lb3l',
    'la4l',
    'lb4l',
    'la5l',
    'lb5l'
];
export const WALLET_TRANSACTION_SUPPORTED_VERSION              = MODE_TEST_NETWORK ? WALLET_TRANSACTION_SUPPORTED_VERSION_TEST_NETWORK : WALLET_TRANSACTION_SUPPORTED_VERSION_MAIN_NETWORK;
export const WALLET_TRANSACTION_QUEUE_SIZE_MAX                 = 1000;
export const WALLET_TRANSACTION_QUEUE_SIZE_NORMAL              = 250;
export const WALLET_AGGREGATION_TRANSACTION_MAX                = 1;
export const WALLET_AGGREGATION_TRANSACTION_OUTPUT_COUNT       = 1;
export const WALLET_AGGREGATION_TRANSACTION_INPUT_COUNT        = 120;
export const WALLET_AGGREGATION_CONSUME_SMALLER_FIRST          = true;
export const WALLET_AGGREGATION_AUTO_ENABLED                   = true;
export const WALLET_AGGREGATION_AUTO_INTERVAL                  = 600000 /*10 min*/;
export const WALLET_AGGREGATION_AUTO_OUTPUT_MIN                = 50;
export const NETWORK_LONG_TIME_WAIT_MAX                        = 3000;
export const NETWORK_SHORT_TIME_WAIT_MAX                       = 1500;
export const DATABASE_ENGINE                                   = 'sqlite';
export const DATABASE_CONNECTION                               = {};
export const STORAGE_CONNECTION                                = {};
export const MILLIX_CIRCULATION                                = 9e15;
export const NODE_MILLIX_BUILD_DATE                            = getConstValue('NODE_MILLIX_BUILD_DATE');
export const NODE_MILLIX_VERSION                               = getConstValue('NODE_MILLIX_VERSION');
export const DATA_BASE_DIR_MAIN_NETWORK                        = getConstValue('DATA_BASE_DIR_MAIN_NETWORK');
export const DATA_BASE_DIR_TEST_NETWORK                        = getConstValue('DATA_BASE_DIR_TEST_NETWORK');
let DATA_BASE_DIR                                              = MODE_TEST_NETWORK ? DATA_BASE_DIR_TEST_NETWORK : DATA_BASE_DIR_MAIN_NETWORK;
export const NODE_KEY_PATH                                     = DATA_BASE_DIR + '/node.json';
export const NODE_CERTIFICATE_KEY_PATH                         = DATA_BASE_DIR + '/node_certificate_key.pem';
export const NODE_CERTIFICATE_PATH                             = DATA_BASE_DIR + '/node_certificate.pem';
export const WALLET_KEY_PATH                                   = DATA_BASE_DIR + '/millix_private_key.json';
export const JOB_CONFIG_PATH                                   = DATA_BASE_DIR + '/job.json';
export const JOB_CONFIG_VERSION                                = 7;
export const SHARD_ZERO_NAME                                   = 'shard_zero';
export const DEBUG_LOG_FILTER                                  = getConstValue('DEBUG_LOG_FILTER');
export const CHUNK_SIZE                                        = 50331648; //48MB
export const MAX_STORAGE_RESERVED                              = 1073741824; //1GB
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
    DATABASE_CONNECTION.MAX_CONNECTIONS                         = 1;
    DATABASE_CONNECTION.FOLDER                                  = DATA_BASE_DIR + '/';
    DATABASE_CONNECTION.FILENAME_MILLIX                         = 'millix.sqlite';
    DATABASE_CONNECTION.FILENAME_TRANSACTION_QUEUE              = 'millix_transaction_queue.sqlite';
    DATABASE_CONNECTION.FILENAME_TRANSACTION_SPEND_QUEUE        = 'millix_transaction_spend_queue.sqlite';
    DATABASE_CONNECTION.FILENAME_TRANSACTION_SPEND_WALLET_QUEUE = 'millix_transaction_spend_wallet_queue.sqlite';
    DATABASE_CONNECTION.FILENAME_TRANSACTION_UNRESOLVED_QUEUE   = 'millix_transaction_unresolved_queue.sqlite';
    DATABASE_CONNECTION.FILENAME_JOB_ENGINE                     = 'millix_job_engine.sqlite';
    DATABASE_CONNECTION.SCRIPT_INIT_MILLIX                      = './scripts/initialize-millix-sqlite3.sql';
    DATABASE_CONNECTION.SCRIPT_INIT_MILLIX_SHARD                = './scripts/initialize-millix-shard-sqlite3.sql';
    DATABASE_CONNECTION.SCRIPT_INIT_MILLIX_JOB_ENGINE           = './scripts/initialize-millix-job-engine-sqlite3.sql';
    DATABASE_CONNECTION.SCRIPT_MIGRATION_DIR                    = './scripts/migration';
    DATABASE_CONNECTION.SCRIPT_MIGRATION_SHARD_DIR              = './scripts/migration/shard';
    DATABASE_CONNECTION.SCHEMA_VERSION                          = '26';
}

STORAGE_CONNECTION.FOLDER                 = DATA_BASE_DIR + '/storage/';
STORAGE_CONNECTION.PENDING_TO_SEND        = DATA_BASE_DIR + '/storage/sending.log';
STORAGE_CONNECTION.PENDING_TO_RECEIVE     = DATA_BASE_DIR + '/storage/receiving.log';
STORAGE_CONNECTION.FILENAME_STORAGE_QUEUE = 'millix_storage_queue.sqlite';

export default {
    MODE_DEBUG,
    NODE_DNS_SERVER,
    NODE_STORAGE_PORT_CHECK,
    MODE_STORAGE_SYNC,
    MODE_STORAGE_SYNC_FULL,
    MODE_NODE_SYNC_FULL,
    MODE_NODE_VALIDATION_FULL,
    FORCE_QUEUE_UPDATE,
    MODE_TEST_NETWORK,
    NODE_PORT_STORAGE_RECEIVER,
    NODE_PORT_STORAGE_PROVIDER,
    NODE_PORT,
    NODE_PORT_DISCOVERY,
    NODE_HOST,
    NODE_HOST_FORCE,
    NODE_BIND_IP,
    NODE_NAT_PMP,
    NODE_NAT_PMP_CHECK,
    WEBSOCKET_PROTOCOL,
    RPC_INTERFACE,
    ADDRESS_VERSION_NFT,
    ADDRESS_VERSION_ESCROW,
    ADDRESS_VERSION_BRIDGE,
    ACTIVE_LANGUAGE_GUID,
    NODE_INITIAL_LIST,
    NODE_CONNECTION_STATIC,
    NODE_CONNECTION_INBOUND_MAX,
    NODE_CONNECTION_OUTBOUND_MAX,
    NODE_CONNECTION_INBOUND_WHITELIST,
    NODE_CONNECTION_OUTBOUND_WHITELIST,
    NODE_PUBLIC,
    NODE_MILLIX_BUILD_DATE,
    NODE_MILLIX_VERSION,
    NODE_KEY_PATH,
    NODE_PORT_API,
    NODE_PORT_VPN,
    NODE_PORT_BROKER,
    NODE_CERTIFICATE_KEY_PATH,
    NODE_CERTIFICATE_PATH,
    DATABASE_ENGINE,
    DATABASE_CONNECTION,
    STORAGE_CONNECTION,
    BRIDGE_ADDRESS,
    WALLET_KEY_PATH,
    MILLIX_CIRCULATION,
    EXTERNAL_API_NOTIFICATION,
    CONSENSUS_VALIDATION_DEPTH_MAX,
    BRIDGE_TRANSACTION_VERSION_MINT,
    BRIDGE_TRANSACTION_VERSION_BURN,
    CONSENSUS_VALIDATION_REQUEST_DEPTH_MAX,
    CONSENSUS_ROUND_VALIDATION_MAX,
    CONSENSUS_ROUND_VALIDATION_REQUIRED,
    CONSENSUS_ROUND_DOUBLE_SPEND_MAX,
    CONSENSUS_ROUND_NOT_FOUND_MAX,
    EXTERNAL_WALLET_KEY_IDENTIFIER,
    CONSENSUS_VALIDATION_WAIT_TIME_MAX,
    CONSENSUS_WATCHDOG_WAIT_TIME_MAX,
    CONSENSUS_VALIDATION_RETRY_WAIT_TIME,
    CONSENSUS_VALIDATION_PARALLEL_PROCESS_MAX,
    CONSENSUS_VALIDATION_PARALLEL_REQUEST_MAX,
    CONSENSUS_VALIDATION_INPUT_TRANSACTION_RESET,
    NODE_CONNECTION_PUBLIC_PERCENT,
    CLOUD_AUTHORITY_PUBLIC_KEY,
    CLOUD_NODE_VERSION_MIN,
    CLOUD_OFFER_SERVICE_LIST,
    CLOUD_OFFER_DURATION_MAX,
    CLOUD_OFFER_CLOCK_SKEW_TOLERANCE,
    CLOUD_OFFER_BROKER_MAX,
    CLOUD_OFFER_SIZE_MAX,
    CLOUD_OFFER_LIST_SIZE_MAX,
    CLOUD_OFFER_PRUNE_WAIT_TIME,
    ESCROW_ACTIVATION_DATE,
    ESCROW_NODE_VERSION_MIN,
    ESCROW_TERMS_VERSION,
    MODE_CLOUD_BROKER,
    CLOUD_BROKER_LIST,
    CLOUD_BROKER_PASS_PRICE,
    CLOUD_BROKER_PASS_DATA_BYTES,
    CLOUD_BROKER_PASS_PIECE_BYTES,
    CLOUD_BROKER_PASS_DURATION,
    CLOUD_BROKER_POOL_RATE,
    CLOUD_BROKER_PAYOUT_INTERVAL,
    CLOUD_BROKER_PAYOUT_AMOUNT_MIN,
    CLOUD_BROKER_REPORT_INTERVAL,
    CLOUD_PASS_PAYMENT_WAIT_TIME_MAX,
    CLOUD_BROKER_PAYOUT_OUTPUT_MAX,
    CLOUD_BROKER_REPORT_RECEIPT_MAX,
    CLOUD_PASS_PIECE_COUNT_MAX,
    CLOUD_PASS_DURATION_MAX,
    ESCROW_RECEIPT_VERSION,
    ESCROW_PORTION_BYTES_MIN,
    ESCROW_UNLOCK_DURATION_MAX,
    ESCROW_TASK_WAIT_TIME,
    ESCROW_CLAIM_AMOUNT_MIN,
    ESCROW_CLAIM_BEFORE_UNLOCK,
    MODE_VPN_EXIT,
    VPN_RECEIPT_INTERVAL_BYTES,
    VPN_RECEIPT_GAP_BYTES_MAX,
    VPN_SESSION_IDLE_TIME_MAX,
    VPN_SESSION_MAX,
    VPN_ESCROW_PORTION_BYTES,
    VPN_ESCROW_PORTION_AMOUNT,
    VPN_ESCROW_UNLOCK_REMAINING_MIN,
    VPN_ALLOWED_PORT_LIST,
    VPN_AUTH_WAIT_TIME_MAX,
    CONSENSUS_ROUND_NODE_COUNT,
    TRANSACTION_FEE_PROXY,
    TRANSACTION_FEE_NETWORK,
    TRANSACTION_FEE_DEFAULT,
    TRANSACTION_PRUNE_AGE_MIN,
    TRANSACTION_TIME_LIMIT_PROXY,
    TRANSACTION_PRUNE_COUNT,
    TRANSACTION_INPUT_MAX,
    TRANSACTION_OUTPUT_MAX,
    TRANSACTION_PARENT_MAX,
    TRANSACTION_SIGNATURE_MAX,
    TRANSACTION_RETRY_SYNC_MAX,
    TRANSACTION_CLOCK_SKEW_TOLERANCE,
    TRANSACTION_PROGRESSIVE_SYNC_TIMESPAN,
    TRANSACTION_OUTPUT_REFRESH_OLDER_THAN,
    TRANSACTION_OUTPUT_EXPIRE_OLDER_THAN,
    NETWORK_LONG_TIME_WAIT_MAX,
    NETWORK_SHORT_TIME_WAIT_MAX,
    WALLET_ADDRESS_GENERATE_MAX,
    WALLET_AGGREGATION_AUTO_ENABLED,
    WALLET_AGGREGATION_AUTO_INTERVAL,
    WALLET_AGGREGATION_AUTO_OUTPUT_MIN,
    WALLET_TRANSACTION_QUEUE_SIZE_MAX,
    WALLET_AGGREGATION_TRANSACTION_MAX,
    WALLET_AGGREGATION_TRANSACTION_OUTPUT_COUNT,
    WALLET_AGGREGATION_TRANSACTION_INPUT_COUNT,
    WALLET_AGGREGATION_CONSUME_SMALLER_FIRST,
    WALLET_TRANSACTION_QUEUE_SIZE_NORMAL,
    WALLET_STARTUP_ADDRESS_BALANCE_SCAN_COUNT,
    WALLET_TRANSACTION_SUPPORTED_VERSION,
    WALLET_TRANSACTION_DEFAULT_VERSION,
    WALLET_TRANSACTION_REFRESH_VERSION,
    WALLET_LOG_SIZE_MAX,
    PEER_ROTATION_MORE_THAN_AVERAGE,
    PEER_ROTATION_MORE_THAN_MOST,
    PEER_ROTATION_MORE_THAN_ALL,
    PEER_ROTATION_CONFIG,
    JOB_CONFIG_PATH,
    JOB_CONFIG_VERSION,
    DEBUG_LOG_FILTER,
    CHUNK_SIZE,
    MAX_STORAGE_RESERVED
};
