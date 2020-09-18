PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

UPDATE schema_information SET value = "4" WHERE key = "version";

CREATE TABLE shard
(
    shard_id       CHAR(50)      NOT NULL PRIMARY KEY CHECK (length(shard_id) <= 50),
    shard_name     CHAR(255)     NOT NULL CHECK (length(shard_name) <= 255),
    shard_type     CHAR(255)     NOT NULL CHECK (length(shard_type) <= 255),
    schema_name    CHAR(255)     NOT NULL CHECK (length(schema_name) <= 255),
    schema_path    CHAR(1024)    NOT NULL CHECK (length(schema_path) <= 1024),
    is_required    TINYINT       NOT NULL DEFAULT 1 CHECK (length(is_required) <= 3 AND TYPEOF(is_required) = 'integer'),
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

INSERT INTO shard (shard_id, shard_name, shard_type, schema_name, schema_path, node_id_origin, shard_date, node_signature) VALUES ("?shard_id", "?shard_name", "?shard_type", "?schema_name", "?schema_path", "?node_id_origin", ?shard_date, "?node_signature");

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

DROP TABLE IF EXISTS `transaction`;
DROP TABLE IF EXISTS transaction_parent;
DROP TABLE IF EXISTS transaction_signature;
DROP TABLE IF EXISTS transaction_input;
DROP TABLE IF EXISTS transaction_output;
DROP TABLE IF EXISTS transaction_output_attribute;
DROP TABLE IF EXISTS audit_verification;
DROP TABLE IF EXISTS audit_point;

COMMIT;
