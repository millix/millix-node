PRAGMA journal_mode= WAL;
PRAGMA auto_vacuum= FULL;
PRAGMA journal_size_limit = 4096;
-- -----------------------
-- wallet tables
-- wallet composed of a BIP44 key
CREATE TABLE wallet
(
    wallet_id   CHAR(44)    NOT NULL PRIMARY KEY,
    wallet_name VARCHAR(20) NULL,
    account     SMALLINT    NOT NULL DEFAULT 0,
    status      SMALLINT    NOT NULL DEFAULT 1,
    create_date INT         NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- BIP44 addresses. Coin type and account are fixed and stored in credentials in localstorage.
-- derivation path is m/44'/0'/account'/is_change/address_position
CREATE TABLE keychain
(
    address_base      CHAR(34) NOT NULL PRIMARY KEY,
    address_position  INT      NOT NULL,
    address_attribute TEXT     NOT NULL,
    wallet_id         CHAR(44) NOT NULL,
    is_change         TINYINT  NOT NULL,
    status            SMALLINT NOT NULL DEFAULT 1,
    create_date       INT      NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE (wallet_id, is_change, address_position),
    FOREIGN KEY (wallet_id) REFERENCES wallet (wallet_id)
);

CREATE TABLE keychain_address
(
    address                CHAR(71) NOT NULL,
    address_base           CHAR(34) NOT NULL,
    address_version        CHAR(3)  NOT NULL,
    address_key_identifier CHAR(34) NOT NULL,
    status                 SMALLINT NOT NULL DEFAULT 1,
    create_date            INT      NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (address_base, address_version, address_key_identifier),
    FOREIGN KEY (address_base) REFERENCES keychain (address_base)
);
CREATE INDEX idx_keychain_address_address_base_address_key_identifier ON keychain_address (address, address_key_identifier);
CREATE INDEX idx_keychain_address_address_key_identifier ON keychain_address (address_key_identifier);


CREATE TABLE `transaction`
(
    transaction_id   CHAR(44)    NOT NULL PRIMARY KEY, -- sha256 in base64
    shard_id         CHAR(32)    NOT NULL,
    transaction_date INT         NOT NULL,
    node_id_origin   VARCHAR(32) NOT NULL,
    version          VARCHAR(3)  NOT NULL DEFAULT '0a0',
    payload_hash     CHAR(44)    NOT NULL,
    stable_date      INT         NULL,
    is_stable        TINYINT     NOT NULL DEFAULT 0,
    parent_date      INT         NULL,
    is_parent        TINYINT     NOT NULL DEFAULT 0,
    timeout_date     INT         NULL,
    is_timeout       TINYINT     NOT NULL DEFAULT 0,
    status           SMALLINT    NOT NULL DEFAULT 1,
    create_date      INT         NOT NULL DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX idx_transaction_status_is_stable_transaction_date ON `transaction` (status, is_stable, transaction_date);
CREATE INDEX idx_transaction_id_is_stable_is_parent ON `transaction` (transaction_id, is_stable, is_parent);
CREATE INDEX idx_transaction_date ON `transaction` (transaction_date);
CREATE INDEX idx_transaction_id_transaction_date ON `transaction` (transaction_id, transaction_date);
CREATE INDEX idx_transaction_is_parent ON `transaction` (is_parent);
CREATE INDEX idx_transaction_is_stable_transaction_date ON `transaction` (is_stable, transaction_date);

CREATE TABLE transaction_parent
(
    transaction_id_child  CHAR(44) NOT NULL,
    transaction_id_parent CHAR(44) NOT NULL,
    shard_id              CHAR(32) NOT NULL,
    status                SMALLINT NOT NULL DEFAULT 1,
    create_date           INT      NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (transaction_id_parent, transaction_id_child),
    FOREIGN KEY (transaction_id_child) REFERENCES `transaction` (transaction_id)
);
CREATE INDEX idx_transaction_parent_transaction_id_child ON transaction_parent (transaction_id_child);

-- current list of all known from-addresses
CREATE TABLE address
(
    address                CHAR(71) NOT NULL,
    address_base           CHAR(34) NOT NULL,
    address_version        CHAR(3)  NOT NULL,
    address_key_identifier CHAR(34) NOT NULL,
    address_attribute      TEXT,
    status                 SMALLINT NOT NULL DEFAULT 1,
    create_date            INT      NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (address_base, address_version, address_key_identifier)
);
CREATE INDEX idx_address_address_base_address_key_identifier ON address (address, address_key_identifier);
CREATE INDEX idx_address_address_key_identifier ON address (address_key_identifier);

CREATE TABLE transaction_signature
(
    transaction_id CHAR(44) NOT NULL,
    shard_id       CHAR(32) NOT NULL,
    address_base   CHAR(34) NOT NULL,
    signature      CHAR(44) NOT NULL,
    status         SMALLINT NOT NULL DEFAULT 1,
    create_date    INT      NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (transaction_id, address_base),
    FOREIGN KEY (transaction_id) REFERENCES `transaction` (transaction_id),
    FOREIGN KEY (address_base) REFERENCES address (address_base)
);
CREATE INDEX idx_transaction_signature_address ON transaction_signature (address_base);

CREATE TABLE transaction_input
(
    transaction_id          CHAR(44) NOT NULL,
    shard_id                CHAR(32) NOT NULL,
    input_position          TINYINT  NOT NULL,
    output_transaction_id   CHAR(44) NULL,
    output_position         TINYINT  NULL,
    output_shard_id         CHAR(32) NULL,
    output_transaction_date INT      NULL,
    double_spend_date       INT      NULL,
    is_double_spend         TINYINT  NOT NULL DEFAULT 0,
    address                 CHAR(71) NULL,
    address_key_identifier  CHAR(34) NULL,
    status                  SMALLINT NOT NULL DEFAULT 1,
    create_date             INT      NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (transaction_id, input_position),
    FOREIGN KEY (transaction_id) REFERENCES `transaction` (transaction_id),
    FOREIGN KEY (address, address_key_identifier) REFERENCES address (address, address_key_identifier)
);
CREATE INDEX idx_transaction_input_address_key_identifier ON transaction_input (address_key_identifier);
CREATE INDEX idx_transaction_input_address_is_double_spend ON transaction_input (address, is_double_spend);
CREATE INDEX idx_transaction_input_transaction_id ON transaction_input (transaction_id);
CREATE INDEX idx_transaction_input_output_transaction_id_output_position ON transaction_input (output_transaction_id, output_position);

CREATE TABLE transaction_output
(
    transaction_id         CHAR(44) NOT NULL,
    shard_id               CHAR(32) NOT NULL,
    output_position        TINYINT  NOT NULL,
    address                CHAR(71) NOT NULL,
    address_key_identifier CHAR(34) NOT NULL,
    amount                 BIGINT   NOT NULL,
    stable_date            INT      NULL, -- NULL if not stable yet
    is_stable              TINYINT  NOT NULL DEFAULT 0,
    spent_date             INT      NULL,
    is_spent               TINYINT  NOT NULL DEFAULT 0,
    double_spend_date      INT      NULL, -- NOT NULL if double spend
    is_double_spend        TINYINT  NOT NULL DEFAULT 0,
    status                 SMALLINT NOT NULL DEFAULT 1,
    create_date            INT      NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (transaction_id, output_position),
    FOREIGN KEY (transaction_id) REFERENCES `transaction` (transaction_id),
    FOREIGN KEY (address, address_key_identifier) REFERENCES address (address, address_key_identifier)
);
CREATE INDEX idx_transaction_output_address_key_identifier ON transaction_output (address_key_identifier);
CREATE INDEX idx_transaction_output_address_is_spent ON transaction_output (address, is_spent);
CREATE INDEX idx_transaction_output_address_create_date ON transaction_output (address, create_date);
CREATE INDEX idx_transaction_output_address_is_stable_is_spent_is_double_spend ON transaction_output (address, is_stable, is_spent, is_double_spend);
CREATE INDEX idx_transaction_output_transaction_id_is_stable_is_double_spend ON transaction_output (transaction_id, is_stable, is_double_spend);
CREATE INDEX idx_transaction_output_transaction_id_is_spent ON transaction_output (transaction_id, is_spent);


CREATE TABLE transaction_output_attribute
(
    transaction_output_id      CHAR(20) NOT NULL,
    transaction_output_type_id CHAR(20) NOT NULL,
    shard_id                   CHAR(32) NOT NULL,
    value                      TEXT     NOT NULL,
    status                     SMALLINT NOT NULL DEFAULT 1,
    create_date                INT      NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (transaction_output_id, transaction_output_type_id),
    FOREIGN KEY (transaction_output_id) REFERENCES transaction_output (transaction_id),
    FOREIGN KEY (transaction_output_type_id) REFERENCES transaction_output_type (transaction_output_type_id)
);

CREATE TABLE transaction_output_type
(
    transaction_output_type_id CHAR(20)     NOT NULL PRIMARY KEY,
    attribute_type             VARCHAR(255) NOT NULL UNIQUE,
    status                     SMALLINT     NOT NULL DEFAULT 0,
    create_date                INT          NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE audit_verification
(
    transaction_id     CHAR(44) NOT NULL PRIMARY KEY,
    shard_id           CHAR(32) NOT NULL,
    attempt_count      INT      NOT NULL DEFAULT 0,
    verification_count INT      NOT NULL DEFAULT 0,
    verified_date      INT      NULL,
    is_verified        TINYINT  NOT NULL DEFAULT 0,
    status             SMALLINT NOT NULL DEFAULT 1,
    create_date        INT      NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (transaction_id) REFERENCES `transaction` (transaction_id)
);
CREATE INDEX idx_audit_verification_transaction_id_is_verified ON audit_verification (transaction_id, is_verified);
CREATE INDEX idx_audit_verification_verified_date ON audit_verification (verified_date);

CREATE TABLE audit_point
(
    audit_point_id CHAR(20) NOT NULL,
    transaction_id CHAR(44) NOT NULL,
    shard_id       CHAR(32) NOT NULL,
    status         SMALLINT NOT NULL DEFAULT 1,
    create_date    INT      NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (audit_point_id, transaction_id),
    FOREIGN KEY (transaction_id) REFERENCES `transaction` (transaction_id)
);
CREATE INDEX idx_audit_point_transaction_id ON audit_point (transaction_id);
CREATE INDEX idx_audit_point_status_transaction_id ON audit_point (status, transaction_id);
CREATE INDEX idx_audit_point_id ON audit_point (audit_point_id);

CREATE TABLE node
(
    node_id         VARCHAR(32) NULL,
    node_prefix     VARCHAR(10) NOT NULL,
    node_ip_address VARCHAR(45) NOT NULL,
    node_port       INT         NOT NULL,
    status          SMALLINT    NOT NULL DEFAULT 1,
    update_date     INT         NOT NULL DEFAULT (strftime('%s', 'now')),
    create_date     INT         NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (node_prefix, node_ip_address, node_port)
);

CREATE TABLE node_attribute
(
    node_id           CHAR(20) NOT NULL,
    attribute_type_id CHAR(20) NOT NULL,
    value             TEXT     NOT NULL,
    status            SMALLINT NOT NULL DEFAULT 1,
    create_date       INT      NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (node_id, attribute_type_id),
    FOREIGN KEY (node_id) REFERENCES node (node_id),
    FOREIGN KEY (attribute_type_id) REFERENCES node_attribute_type (attribute_type_id)
);

CREATE TABLE node_attribute_type
(
    attribute_type_id CHAR(20)     NOT NULL PRIMARY KEY,
    attribute_type    VARCHAR(255) NOT NULL UNIQUE,
    status            SMALLINT     NOT NULL DEFAULT 1,
    create_date       INT          NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- to be optimized SELECT DISTINCT transactions.*, inputs.address as input_address, outputs.address as output_address, outputs.amount as amount FROM transactions LEFT JOIN outputs on outputs.transaction_id = transactions.transaction_id LEFT JOIN inputs on inputs.transaction_id = transactions.transaction_id WHERE (outputs.address in ( '', '', '') OR inputs.address in ( '', '') AND input_address != output_address

CREATE TABLE config
(
    config_id   CHAR(20)     NOT NULL PRIMARY KEY,
    config_name VARCHAR(255) NOT NULL UNIQUE,
    value       VARCHAR(255) NOT NULL,
    type        VARCHAR(50)  NOT NULL,
    status      SMALLINT     NOT NULL DEFAULT 1,
    create_date INT          NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE schema_information
(
    key         VARCHAR(255) NOT NULL UNIQUE,
    value       VARCHAR(255) NOT NULL,
    status      SMALLINT     NOT NULL DEFAULT 1,
    create_date INT          NOT NULL DEFAULT (strftime('%s', 'now'))
);

INSERT INTO schema_information (key, value) VALUES ("version", "1");

CREATE TABLE address_version
(
    version         CHAR(3)      NOT NULL UNIQUE,
    is_main_network SMALLINT     NOT NULL DEFAULT 1,
    regex_pattern   VARCHAR(255) NOT NULL,
    is_default      SMALLINT     NOT NULL DEFAULT 0,
    status          SMALLINT     NOT NULL DEFAULT 1,
    create_date     INT          NOT NULL DEFAULT (strftime('%s', 'now'))
);

INSERT INTO address_version(version, is_main_network, is_default, regex_pattern)
VALUES ("0a0", 1, 1, "(?<address>.*)(?<version>0a0)(?<identifier>.*)"),
       ("lal", 0, 1, "(?<address>.*)(?<version>lal)(?<identifier>.*)");
