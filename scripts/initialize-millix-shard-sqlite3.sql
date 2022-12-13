PRAGMA journal_mode= WAL;
PRAGMA auto_vacuum= FULL;
PRAGMA journal_size_limit = 4096;

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
    status           TINYINT     NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'), /*1: default, 2: prune, 3: invalid*/
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
    FOREIGN KEY (transaction_id) REFERENCES `transaction` (transaction_id)
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
    FOREIGN KEY (transaction_id) REFERENCES `transaction` (transaction_id)
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
    status                 TINYINT  NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date            INT      NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer'),
    PRIMARY KEY (transaction_id, output_position),
    FOREIGN KEY (transaction_id) REFERENCES `transaction` (transaction_id)
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
    FOREIGN KEY (transaction_id) REFERENCES `transaction` (transaction_id)
);
CREATE INDEX idx_transaction_output_attribute_create_date ON transaction_output_attribute (create_date);

CREATE TABLE schema_information
(
    key         TEXT         NOT NULL UNIQUE,
    value       TEXT         NOT NULL,
    status      TINYINT      NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date INT          NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_schema_information_create_date ON schema_information (create_date);

INSERT INTO schema_information (key, value) VALUES ("version", "23");
