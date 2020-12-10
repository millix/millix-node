PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

CREATE TABLE new_transaction
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
    status           TINYINT     NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date      INT         NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
INSERT INTO new_transaction (transaction_id, shard_id, transaction_date, node_id_origin, node_id_proxy, version, payload_hash, stable_date, is_stable, parent_date, is_parent, timeout_date, is_timeout, status, create_date) SELECT transaction_id, shard_id, transaction_date, node_id_origin, NULL, version, payload_hash, stable_date, is_stable, parent_date, is_parent, timeout_date, is_timeout, status, create_date FROM `transaction`;
DROP TABLE `transaction`;
ALTER TABLE new_transaction RENAME TO `transaction`;

CREATE INDEX idx_transaction_status_is_stable_transaction_date ON `transaction` (status, is_stable, transaction_date);
CREATE INDEX idx_transaction_id_is_stable_is_parent ON `transaction` (transaction_id, is_stable, is_parent);
CREATE INDEX idx_transaction_date ON `transaction` (transaction_date);
CREATE INDEX idx_transaction_id_transaction_date ON `transaction` (transaction_id, transaction_date);
CREATE INDEX idx_transaction_is_parent ON `transaction` (is_parent);
CREATE INDEX idx_transaction_is_stable_transaction_date ON `transaction` (is_stable, transaction_date);
CREATE INDEX idx_transaction_create_date ON `transaction` (create_date);

DROP TABLE IF EXISTS transaction_output_attribute;
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

DROP TABLE IF EXISTS transaction_output_type;
CREATE TABLE transaction_output_attribute_type
(
    attribute_type_id   CHAR(20)     NOT NULL PRIMARY KEY CHECK (length(attribute_type_id) <= 20),
    attribute_type      CHAR(255)    NOT NULL UNIQUE CHECK (length(attribute_type) <= 255),
    status              SMALLINT     NOT NULL DEFAULT 0 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date         INT          NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_transaction_output_attribute_type_create_date ON transaction_output_attribute_type (create_date);

CREATE INDEX idx_transaction_output_output_position ON transaction_output (output_position);

INSERT OR IGNORE INTO normalization (normalization_name, normalization_id)
VALUES ('transaction_fee', '360NCKsWffvH48QDlh4a');

INSERT INTO transaction_output_attribute_type (attribute_type_id, attribute_type) VALUES ('360NCKsWffvH48QDlh4a', 'transaction_fee');

UPDATE schema_information SET value = "12" WHERE key = "version";

COMMIT;
