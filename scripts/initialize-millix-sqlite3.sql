PRAGMA journal_mode= WAL;
PRAGMA auto_vacuum= FULL;
PRAGMA journal_size_limit = 4096;
-- -----------------------
-- wallet tables
-- wallet composed of a BIP44 key
CREATE TABLE wallet
(
    wallet_id   CHAR(44)    NOT NULL PRIMARY KEY CHECK (length(wallet_id) <= 44),
    wallet_name CHAR(20)    NULL CHECK (length(wallet_name) <= 20),
    account     TINYINT     NOT NULL DEFAULT 0 CHECK (length(account) <= 3 AND TYPEOF(account) = 'integer'),
    status      TINYINT     NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date INT         NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_wallet_create_date ON wallet (create_date);

-- BIP44 addresses. Coin type and account are fixed and stored in credentials in localstorage.
-- derivation path is m/44'/0'/account'/is_change/address_position
CREATE TABLE keychain
(
    address_base      CHAR(34) NOT NULL PRIMARY KEY CHECK (length(address_base) <= 34),
    address_position  INT      NOT NULL CHECK (length(address_position) <= 10 AND TYPEOF(address_position) = 'integer'),
    wallet_id         CHAR(44) NOT NULL CHECK (length(wallet_id) <= 44),
    is_change         TINYINT  NOT NULL CHECK (is_change = 0 OR is_change=1),
    status            TINYINT  NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date       INT      NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer'),
    UNIQUE (wallet_id, is_change, address_position),
    FOREIGN KEY (wallet_id) REFERENCES wallet (wallet_id)
);
CREATE INDEX idx_keychain_create_date ON keychain (create_date);

CREATE TABLE keychain_address
(
    address                CHAR(72) NOT NULL CHECK (length(address) <= 72),
    address_base           CHAR(34) NOT NULL CHECK (length(address_base) <= 34),
    address_version        CHAR(4)  NOT NULL CHECK (length(address_version) <= 4),
    address_key_identifier CHAR(34) NOT NULL CHECK (length(address_key_identifier) <= 34),
    status                 SMALLINT NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date            INT      NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer'),
    PRIMARY KEY (address_base, address_version, address_key_identifier),
    FOREIGN KEY (address_base) REFERENCES keychain (address_base)
);
CREATE INDEX idx_keychain_address_address_base_address_key_identifier ON keychain_address (address, address_key_identifier);
CREATE INDEX idx_keychain_address_address_key_identifier ON keychain_address (address_key_identifier);
CREATE INDEX idx_keychain_address_create_date ON keychain_address (create_date);

-- current list of all known from-addresses
CREATE TABLE address
(
    address                CHAR(72) NOT NULL CHECK (length(address) <= 72),
    address_base           CHAR(34) NOT NULL CHECK (length(address_base) <= 34),
    address_version        CHAR(4)  NOT NULL CHECK (length(address_version) <= 4),
    address_key_identifier CHAR(34) NOT NULL CHECK (length(address_key_identifier) <= 34),
    status                 SMALLINT NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date            INT      NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer'),
    PRIMARY KEY (address_base, address_version, address_key_identifier)
);
CREATE INDEX idx_address_address_base_address_key_identifier ON address (address, address_key_identifier);
CREATE INDEX idx_address_address_key_identifier ON address (address_key_identifier);
CREATE INDEX idx_address_create_date ON address (create_date);

CREATE TABLE address_attribute
(
    address_base               CHAR(34) NOT NULL CHECK (length(address_base) <= 34),
    address_attribute_type_id  CHAR(20) NOT NULL CHECK (length(address_attribute_type_id) <= 20),
    value                      TEXT     NOT NULL,
    status                     TINYINT  NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date                INT      NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer'),
    PRIMARY KEY (address_base, address_attribute_type_id),
    FOREIGN KEY (address_base) REFERENCES address (address_base),
    FOREIGN KEY (address_attribute_type_id) REFERENCES address_attribute_type (address_attribute_type_id)
);
CREATE INDEX idx_address_attribute_create_date ON address_attribute (create_date);

CREATE TABLE address_attribute_type
(
    address_attribute_type_id  CHAR(20)     NOT NULL PRIMARY KEY CHECK (length(address_attribute_type_id) <= 20),
    attribute_type             CHAR(255)    NOT NULL UNIQUE CHECK (length(attribute_type) <= 255),
    status                     SMALLINT     NOT NULL DEFAULT 0 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date                INT          NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_address_attribute_type_create_date ON address_attribute_type (create_date);

CREATE TABLE `transaction`
(
    transaction_id   CHAR(50)    NOT NULL PRIMARY KEY CHECK (length(transaction_id) <= 50),
    shard_id         CHAR(50)    NOT NULL CHECK (length(shard_id) <= 50),
    transaction_date INT         NOT NULL CHECK (length(transaction_date) <= 10 AND TYPEOF(transaction_date) = 'integer'),
    node_id_origin   CHAR(34)    NOT NULL CHECK (length(node_id_origin) <= 34),
    node_id_proxy    CHAR(34)    NULL CHECK (length(node_id_proxy) <= 34),
    version          CHAR(4)     NOT NULL DEFAULT '0a0' CHECK (length(version) <= 4),
    payload_hash     CHAR(50)    NOT NULL CHECK (length(payload_hash) <= 50),
    stable_date      INT         NULL CHECK (length(stable_date) <= 10 AND (TYPEOF(stable_date) IN ('integer', 'null'))),
    is_stable        TINYINT     NOT NULL DEFAULT 0 CHECK (is_stable = 0 OR is_stable = 1),
    parent_date      INT         NULL CHECK(length(parent_date) <= 10 AND TYPEOF(parent_date) IN ('integer', 'null')),
    is_parent        TINYINT     NOT NULL DEFAULT 0 CHECK (is_parent = 0 OR is_parent = 1),
    timeout_date     INT         NULL CHECK(length(timeout_date) <= 10 AND TYPEOF(timeout_date) IN ('integer', 'null')),
    is_timeout       TINYINT     NOT NULL DEFAULT 0 CHECK (is_timeout = 0 OR is_timeout = 1),
    status           TINYINT     NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'), /*1: default, 2: expired, 3: invalid*/
    create_date      INT         NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_transaction_status_is_stable_transaction_date ON `transaction` (status, is_stable, transaction_date);
CREATE INDEX idx_transaction_id_is_stable_is_parent ON `transaction` (transaction_id, is_stable, is_parent);
CREATE INDEX idx_transaction_date ON `transaction` (transaction_date);
CREATE INDEX idx_transaction_id_transaction_date ON `transaction` (transaction_id, transaction_date);
CREATE INDEX idx_transaction_is_parent ON `transaction` (is_parent);
CREATE INDEX idx_transaction_is_stable_transaction_date ON `transaction` (is_stable, transaction_date);
CREATE INDEX idx_transaction_create_date ON `transaction` (create_date);

CREATE TABLE transaction_parent
(
    transaction_id_child  CHAR(50) NOT NULL CHECK (length(transaction_id_child) <= 50),
    transaction_id_parent CHAR(50) NOT NULL CHECK (length(transaction_id_parent) <= 50),
    shard_id              CHAR(50) NOT NULL CHECK (length(shard_id) <= 50),
    status                TINYINT  NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date           INT      NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer'),
    PRIMARY KEY (transaction_id_parent, transaction_id_child),
    FOREIGN KEY (transaction_id_child) REFERENCES `transaction` (transaction_id)
);
CREATE INDEX idx_transaction_parent_transaction_id_child ON transaction_parent (transaction_id_child);
CREATE INDEX idx_transaction_parent_create_date ON transaction_parent (create_date);

CREATE TABLE transaction_signature
(
    transaction_id CHAR(50) NOT NULL CHECK (length(transaction_id) <= 50),
    shard_id       CHAR(50) NOT NULL CHECK (length(shard_id) <= 50),
    address_base   CHAR(34) NOT NULL CHECK (length(address_base) <= 34),
    signature      CHAR(88) NOT NULL CHECK (length(signature) <= 88),
    status         TINYINT  NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date    INT      NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer'),
    PRIMARY KEY (transaction_id, address_base),
    FOREIGN KEY (transaction_id) REFERENCES `transaction` (transaction_id),
    FOREIGN KEY (address_base) REFERENCES address (address_base)
);
CREATE INDEX idx_transaction_signature_address ON transaction_signature (address_base);
CREATE INDEX idx_transaction_signature_create_date ON transaction_signature (create_date);

CREATE TABLE transaction_input
(
    transaction_id          CHAR(50) NOT NULL CHECK (length(transaction_id) <= 50),
    shard_id                CHAR(50) NOT NULL CHECK (length(shard_id) <= 50),
    input_position          TINYINT  NOT NULL CHECK (length(input_position) <= 3 AND TYPEOF(input_position) = 'integer'),
    output_transaction_id   CHAR(50) NULL CHECK (length(output_transaction_id) <= 50),
    output_position         TINYINT  NULL CHECK(length(output_position) <= 3 AND TYPEOF(output_position) IN ('integer', 'null')),
    output_shard_id         CHAR(50) NULL CHECK (length(output_shard_id) <= 50),
    output_transaction_date INT      NULL CHECK(length(output_transaction_date) <= 10 AND TYPEOF(output_transaction_date) IN ('integer', 'null')),
    double_spend_date       INT      NULL CHECK(length(double_spend_date) <= 10 AND TYPEOF(double_spend_date) IN ('integer', 'null')),
    is_double_spend         TINYINT  NULL DEFAULT 0 CHECK (is_double_spend = 0 OR is_double_spend = 1 OR is_double_spend IS NULL),
    address                 CHAR(72) NULL CHECK (length(address) <= 72),
    address_key_identifier  CHAR(34) NULL CHECK (length(address_key_identifier) <= 34),
    status                  TINYINT  NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date             INT      NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer'),
    PRIMARY KEY (transaction_id, input_position),
    FOREIGN KEY (transaction_id) REFERENCES `transaction` (transaction_id),
    FOREIGN KEY (address, address_key_identifier) REFERENCES address (address, address_key_identifier)
);
CREATE INDEX idx_transaction_input_status_output_transaction_id ON transaction_input (status, output_transaction_id);
CREATE INDEX idx_transaction_input_address_key_identifier ON transaction_input (address_key_identifier);
CREATE INDEX idx_transaction_input_address_is_double_spend ON transaction_input (address, is_double_spend);
CREATE INDEX idx_transaction_input_transaction_id ON transaction_input (transaction_id);
CREATE INDEX idx_transaction_input_output_transaction_id_output_position ON transaction_input (output_transaction_id, output_position);
CREATE INDEX idx_transaction_input_create_date ON transaction_input (create_date);

CREATE TABLE transaction_output
(
    transaction_id         CHAR(50) NOT NULL CHECK (length(transaction_id) <= 50),
    shard_id               CHAR(50) NOT NULL CHECK (length(shard_id) <= 50),
    output_position        TINYINT  NOT NULL CHECK (length(output_position) <= 3 AND TYPEOF(output_position) = 'integer'),
    address                CHAR(72) NOT NULL CHECK (length(address) <= 72),
    address_key_identifier CHAR(34) NOT NULL CHECK (length(address_key_identifier) <= 34),
    amount                 BIGINT   NOT NULL CHECK (TYPEOF(amount) IN ('integer','real')),
    stable_date            INT      NULL CHECK(length(stable_date) <= 10 AND TYPEOF(stable_date) IN ('integer', 'null')), -- NULL if not stable yet
    is_stable              TINYINT  NOT NULL DEFAULT 0 CHECK (is_stable = 0 OR is_stable = 1),
    spent_date             INT      NULL CHECK(length(spent_date) <= 10 AND TYPEOF(spent_date) IN ('integer', 'null')),
    is_spent               TINYINT  NOT NULL DEFAULT 0 CHECK (is_spent = 0 OR is_spent = 1),
    double_spend_date      INT      NULL CHECK(length(double_spend_date) <= 10 AND TYPEOF(double_spend_date) IN ('integer', 'null')), -- NOT NULL if double spend
    is_double_spend        TINYINT  NOT NULL DEFAULT 0 CHECK (is_double_spend = 0 OR is_double_spend = 1),
    status                 TINYINT  NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'), /*1: default, 2: expired*/
    create_date            INT      NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer'),
    PRIMARY KEY (transaction_id, output_position),
    FOREIGN KEY (transaction_id) REFERENCES `transaction` (transaction_id),
    FOREIGN KEY (address, address_key_identifier) REFERENCES address (address, address_key_identifier)
);
CREATE INDEX idx_transaction_output_address_key_identifier_is_stable_is_spent_status ON transaction_output (address_key_identifier, is_stable, is_spent, status);
CREATE INDEX idx_transaction_output_address_key_identifier_spent_double_spend_status ON transaction_output (address_key_identifier, is_spent, is_double_spend, status);
CREATE INDEX idx_transaction_output_address_key_identifier_create_date ON transaction_output (address_key_identifier, create_date);
CREATE INDEX idx_transaction_output_address_is_spent ON transaction_output (address, is_spent);
CREATE INDEX idx_transaction_output_address_create_date ON transaction_output (address, create_date);
CREATE INDEX idx_transaction_output_address_is_stable_is_spent_is_double_spend ON transaction_output (address, is_stable, is_spent, is_double_spend);
CREATE INDEX idx_transaction_output_transaction_id_address_key_identifier ON transaction_output (transaction_id, address_key_identifier);
CREATE INDEX idx_transaction_output_transaction_id_is_stable_is_double_spend ON transaction_output (transaction_id, is_stable, is_double_spend);
CREATE INDEX idx_transaction_output_transaction_id_is_spent ON transaction_output (transaction_id, is_spent);
CREATE INDEX idx_transaction_output_create_date ON transaction_output (create_date);
CREATE INDEX idx_transaction_output_output_position ON transaction_output (output_position);


CREATE TABLE transaction_output_attribute
(
    transaction_id      CHAR(50) NOT NULL CHECK (length(transaction_id) <= 50),
    attribute_type_id   CHAR(20) NOT NULL CHECK (length(attribute_type_id) <= 20),
    shard_id            CHAR(50) NOT NULL CHECK (length(shard_id) <= 50),
    value               TEXT     NOT NULL,
    status              TINYINT  NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date         INT      NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer'),
    PRIMARY KEY (transaction_id, attribute_type_id),
    FOREIGN KEY (transaction_id) REFERENCES `transaction` (transaction_id),
    FOREIGN KEY (attribute_type_id) REFERENCES transaction_output_attribute_type (attribute_type_id)
);
CREATE INDEX idx_transaction_output_attribute_create_date ON transaction_output_attribute (create_date);

CREATE TABLE transaction_output_attribute_type
(
    attribute_type_id   CHAR(20)     NOT NULL PRIMARY KEY CHECK (length(attribute_type_id) <= 20),
    attribute_type      CHAR(255)    NOT NULL UNIQUE CHECK (length(attribute_type) <= 255),
    status              SMALLINT     NOT NULL DEFAULT 0 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date         INT          NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_transaction_output_attribute_type_create_date ON transaction_output_attribute_type (create_date);

CREATE TABLE node
(
    node_id         CHAR(34)    NOT NULL PRIMARY KEY CHECK (length(node_id) <= 34),
    node_prefix     CHAR(10)    NOT NULL CHECK (length(node_prefix) <= 10),
    node_address CHAR(45)       NOT NULL CHECK (length(node_address) <= 45),
    node_port       INT         NOT NULL CHECK (length(node_port) <= 10 AND TYPEOF(node_port) = 'integer'),
    node_port_api   INT         NOT NULL CHECK (length(node_port_api) <= 10 AND TYPEOF(node_port_api) = 'integer'),
    status          TINYINT     NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    update_date     INT         NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(update_date) <= 10 AND TYPEOF(update_date) = 'integer'),
    create_date     INT         NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_node_create_date ON node (create_date);

CREATE TABLE node_attribute
(
    node_id           CHAR(34) NOT NULL CHECK (length(node_id) <= 34),
    attribute_type_id CHAR(20) NOT NULL CHECK (length(attribute_type_id) <= 20),
    value             TEXT     NOT NULL,
    status            TINYINT  NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date       INT      NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer'),
    PRIMARY KEY (node_id, attribute_type_id),
    FOREIGN KEY (node_id) REFERENCES node (node_id),
    FOREIGN KEY (attribute_type_id) REFERENCES node_attribute_type (attribute_type_id)
);
CREATE INDEX idx_node_attribute_create_date ON node_attribute (create_date);

CREATE TABLE node_attribute_type
(
    attribute_type_id CHAR(20)     NOT NULL PRIMARY KEY CHECK (length(attribute_type_id) <= 20),
    attribute_type    TEXT         NOT NULL UNIQUE,
    status            SMALLINT     NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date       INT          NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_node_attribute_type_create_date ON node_attribute_type (create_date);

-- to be optimized SELECT DISTINCT transactions.*, inputs.address as input_address, outputs.address as output_address, outputs.amount as amount FROM transactions LEFT JOIN outputs on outputs.transaction_id = transactions.transaction_id LEFT JOIN inputs on inputs.transaction_id = transactions.transaction_id WHERE (outputs.address in ( '', '', '') OR inputs.address in ( '', '') AND input_address != output_address

CREATE TABLE config
(
    config_id   CHAR(20)     NOT NULL PRIMARY KEY CHECK (length(config_id) <= 20),
    config_name TEXT         NOT NULL UNIQUE,
    value       TEXT         NOT NULL,
    type        TEXT         NOT NULL,
    status      SMALLINT     NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date INT          NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_config_create_date ON config (create_date);

CREATE TABLE schema_information
(
    key         TEXT         NOT NULL UNIQUE,
    value       TEXT         NOT NULL,
    status      TINYINT      NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date INT          NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_schema_information_create_date ON schema_information (create_date);

CREATE TABLE address_version
(
    version         CHAR(4)      NOT NULL UNIQUE CHECK (length(version) <= 4),
    is_main_network TINYINT      NOT NULL DEFAULT 1 CHECK (is_main_network = 0 OR is_main_network = 1),
    regex_pattern   TEXT         NOT NULL,
    is_default      TINYINT      NOT NULL DEFAULT 0 CHECK (is_default = 0 OR is_default = 1),
    status          TINYINT      NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date     INT          NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_address_version_create_date ON address_version (create_date);

CREATE TABLE api
(
    api_id             CHAR(16)   NOT NULL UNIQUE CHECK (length(api_id) <= 16),
    name               CHAR(255)  NOT NULL CHECK (length(name) <= 255),
    description        CHAR(1024) NOT NULL CHECK (length(description) <= 1024),
    method             CHAR(10)   NOT NULL CHECK (length(method) <= 10),
    version_released   CHAR(10)   NOT NULL CHECK (length(version_released) <= 10),
    version_deprecated CHAR(10)   NULL CHECK (length(version_deprecated) <= 10),
    version_removed    CHAR(10)   NULL CHECK (length(version_removed) <= 10),
    permission         TEXT       NOT NULL DEFAULT "true",
    status             TINYINT    NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date        INT        NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK (length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_api_create_date ON api (create_date);

CREATE TABLE shard
(
    shard_id       CHAR(50)      NOT NULL PRIMARY KEY CHECK (length(shard_id) <= 50),
    shard_name     CHAR(255)     NOT NULL CHECK (length(shard_name) <= 255),
    shard_type     CHAR(255)     NOT NULL CHECK (length(shard_type) <= 255),
    schema_name    CHAR(255)     NOT NULL CHECK (length(schema_name) <= 255),
    schema_path    CHAR(1024)    NOT NULL CHECK (length(schema_path) <= 1024),
    is_required    TINYINT       NOT NULL DEFAULT 1 CHECK (is_required = 0 OR is_required = 1),
    record_count   INT           NOT NULL DEFAULT 0 CHECK (length(record_count) <= 3 AND TYPEOF(record_count) = 'integer'),
    disk_size      INT           NOT NULL DEFAULT 0 CHECK (length(disk_size) <= 3 AND TYPEOF(disk_size) = 'integer'),
    node_id_origin CHAR(34)      NOT NULL CHECK (length(node_id_origin) <= 34),
    shard_date     INT           NOT NULL CHECK(length(shard_date) <= 10 AND TYPEOF(shard_date) = 'integer'),
    node_signature CHAR(88)      NOT NULL CHECK (length(node_signature) <= 88),
    update_date    INT           NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(update_date) <= 10 AND TYPEOF(update_date) = 'integer'),
    status         TINYINT       NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date    INT           NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_shard_create_date ON shard (create_date);

CREATE TABLE shard_attribute_type
(
    attribute_type_id CHAR(20)     NOT NULL PRIMARY KEY CHECK (length(attribute_type_id) <= 20),
    attribute_type    CHAR(255)    NOT NULL CHECK (length(attribute_type) <= 255),
    status            TINYINT      NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date       INT          NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_shard_attribute_type_create_date ON shard_attribute_type (create_date);

CREATE TABLE shard_attribute
(
    shard_id          CHAR(50) NOT NULL CHECK (length(shard_id) <= 50),
    attribute_type_id CHAR(20) NOT NULL CHECK (length(attribute_type_id) <= 20),
    value             TEXT     NOT NULL,
    status            SMALLINT NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date       INT      NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer'),
    PRIMARY KEY (shard_id, attribute_type_id),
    FOREIGN KEY (shard_id) REFERENCES shard (shard_id),
    FOREIGN KEY (attribute_type_id) REFERENCES shard_attribute_type (attribute_type_id)
);
CREATE INDEX idx_shard_attribute_create_date ON shard_attribute (create_date);

CREATE TABLE normalization
(
    normalization_id   CHAR(20)     NOT NULL PRIMARY KEY CHECK (length(normalization_id) <= 20),
    normalization_name CHAR(255)    NOT NULL UNIQUE CHECK (length(normalization_name) <= 255),
    status             SMALLINT     NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date        INT          NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_normalization_create_date ON normalization (create_date);

INSERT INTO schema_information (key, value) VALUES ("version", "20");

INSERT INTO address_version(version, is_main_network, is_default, regex_pattern)
VALUES ("0a0", 1, 1, "(?<address>.*)(?<version>0a0)(?<identifier>.*)"),
       ("0b0", 1, 0, "(?<address>.*)(?<version>0b0)(?<identifier>.*)"),
       ("0c0", 1, 0, "(?<address>.*)(?<version>0c0)(?<identifier>.*)"),
       ("lal", 0, 1, "(?<address>.*)(?<version>lal)(?<identifier>.*)"),
       ("la0l", 0, 1, "(?<address>.*)(?<version>la0l)(?<identifier>.*)"),
       ("lb0l", 0, 0, "(?<address>.*)(?<version>lb0l)(?<identifier>.*)"),
       ("lcl", 0, 0, "(?<address>.*)(?<version>lcl)(?<identifier>.*)");

INSERT INTO normalization (normalization_name, normalization_id)
VALUES ('mode_debug', 'AK5rcMMbWw5xIfXVdRVL'),
       ('mode_test_network', 'mHUyg4ZLca4mt7umomEW'),
       ('node_port', 'A4FpnTLmqGSH7nvU9j4x'),
       ('node_port_api', '3rCLWGPWIhqgnjWp5EtV'),
       ('node_host', 'yIarmjiV0B7KgefJI5Kr'),
       ('websocket_protocol', '72lDSYwxagTBZz3ZFxI4'),
       ('rpc_interface', 'CIn93tK47ywajdrlsYxv'),
       ('node_public', '9NUpixQHFRL0Ij6vz1lA'),
       ('node_initial_list_main_network', 'TwWXH3VSHGRhCdRC64Y5'),
       ('node_initial_list_test_network', 'ljXQvhkeXv8dyUCmcGMF'),
       ('node_initial_list', '5aYWBvK3RlMMlM2SHjbO'),
       ('consensus_round_node_count', 'BCtRYOLJ82Zou0HbGwbE'),
       ('consensus_round_validation_required', '5dZrGlCiE7fhZwWplVgv'),
       ('consensus_round_validation_max', '8iM6bSsJ4XGknV6kUtVM'),
       ('consensus_round_not_found_max', 'TcsDuXPzfOCSSAHsNW6U'),
       ('consensus_round_double_spend_max', '6kxA1HYsXx4fYEsJDWZr'),
       ('consensus_validation_depth_max', '0i9B8K4WrfZlBO9xzdMM'),
       ('consensus_validation_request_depth_max', 'Zzh8JnPGTOsi9ZaJHFng'),
       ('consensus_validation_wait_time_max', 'DBvU4CSipttmG9SCn1Lo'),
       ('consensus_validation_retry_wait_time', 'JMDLznR9sfSyuwfK1R5G'),
       ('node_connection_inbound_max', 'of16lAY1fS7K9K7ufSDR'),
       ('node_connection_outbound_max', 'b7qm0K1dHuu00nmIgwCR'),
       ('heartbeat_timeout', 'IvKT7CLUhiUvQ4W286TM'),
       ('heartbeat_response_timeout', 'NUTODkCDasmliuHDQuGF'),
       ('wallet_startup_address_balance_scan_count', 'tlCRczQCuztpgMbAsWIA'),
       ('wallet_log_size_max', 'EdAFKivNnHLl9jIrVSHT'),
       ('wallet_transaction_default_version', 'O3bneunmkY2tbqa1FOVp'),
       ('wallet_transaction_queue_size_max', 'dbdTZKYgnIJgpkq0r7K7'),
       ('wallet_transaction_queue_size_normal', 'FlzDh0b1QlEpOAERQatJ'),
       ('network_long_time_wait_max', 'qvSfStkxR5BKWbYlbQxA'),
       ('network_short_time_wait_max', 'EYAbwP2MDkqYgpIwvUeL'),
       ('database_engine', '7cqxMOo2vMfr8oQGUi3R'),
       ('database_connection', 'wcFVmxvQQM7XdTtrSOpJ'),
       ('millix_circulation', 'EjPRFNdkNJGb8WFr4RkF'),
       ('mode_test', '1ReNaaJHFoaursWbgEnb'),
       ('node_test_host', 'iVcXf6042sKwNQ17YvrQ'),
       ('node_test_port', 'BPkvfTYL4QRmuYtOpt0e'),
       ('node_millix_version', 'ZqKGkHGpChkHfdwBhMJx'),
       ('data_base_dir_main_network', 'h7bOhKpGWtR5y9gkUBqG'),
       ('data_base_dir_test_network', '1b9W3r8XqBoj7Yntr71P'),
       ('node_key_path', '1dBK9jRTqK4r6SKAgb3r'),
       ('node_certificate_key_path', 'n7W8tfvrrCewkCNxQylw'),
       ('node_certificate_path', 'tRuUYRNdJDoeaWkWZzb2'),
       ('wallet_key_path', 'eGs9xpLg5IhnuNWTrDwp'),
       ('job_config_path', 'kixVXMz7RUxUKIgOn8Ii'),
       ('peer_rotation_settings', 'useBqrZ9F8Gv6aVH85pB'),
       ('peer_rotation_more_than_average', 'Z2z0wVCm6Ai1p7OG4MfN'),
       ('peer_rotation_more_than_most', 'hVEmlU6bL4l3DNeOhdM3'),
       ('peer_rotation_more_than_all', 'wpwt2V5vrT28ngz9u3J3'),
       ('peer_rotation_config', 'H2ODFHCxOl1FErIqCDqG'),
       ('shard_zero_name', 'rMSuKEh42OZaeVEgzG62'),
       ('key_public', '9MgxVxyXsM2EozHVUZgw'),
       ('node_key_public', 'GKj5UNJmpx5qCGQnaJjA'),
       ('node_bind_ip', 'Apw9ovpclfW6LvSVYqYD'),
       ('address_default', 'T4CefCfUyoc4CWv7cZ5V'),
       ('node_about', 'ijDj2VlTyJBl5R4iTCmG'),
       ('peer_connection', '8FPirjQYaFIEIF2y7OEA'),
       ('transaction_fee', '360NCKsWffvH48QDlh4a'),
       ('node_public_key', 'KkwWuh5VaHBYlk8lsduD'),
       ('peer_count', 'OfhGqiGJID8WTOZHzl2b'),
       ('shard_protocol', 'kbkMAkuyqOlSNKv7udFz'),
       ('transaction_count', 'qhTfPzLhZENklxNbTQYW'),
       ('transaction_fee_proxy', 'qTCYsDQzIoVbaX8iIjry'),
       ('transaction_fee_network', '9hJcCunmEibhDgoLHzC8'),
       ('transaction_fee_default', 'eoSDGGFKD3dYfcKF1nFO'),
       ('transaction_output_metadata', 'Adl87cz8kC190Nqc');

INSERT INTO address_attribute_type (address_attribute_type_id, attribute_type) VALUES ('9MgxVxyXsM2EozHVUZgw', 'key_public');
INSERT INTO transaction_output_attribute_type (attribute_type_id, attribute_type) VALUES ('360NCKsWffvH48QDlh4a', 'transaction_fee');
