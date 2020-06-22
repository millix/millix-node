PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

UPDATE schema_information SET value = "4" WHERE key = "version";

CREATE TABLE shard
(
    shard_id       CHAR(49)      NOT NULL PRIMARY KEY,
    shard_name     VARCHAR(255)  NOT NULL,
    shard_type     VARCHAR(255)  NOT NULL,
    schema_name    VARCHAR(255)  NOT NULL,
    schema_path    VARCHAR(1024) NOT NULL,
    is_required    SMALLINT      NOT NULL DEFAULT 1,
    record_count   INT           NOT NULL DEFAULT 0,
    disk_size      INT           NOT NULL DEFAULT 0,
    node_id_origin CHAR(34)      NOT NULL,
    shard_date     INT           NOT NULL,
    node_signature CHAR(88)      NOT NULL,
    update_date    INT           NOT NULL DEFAULT (strftime('%s', 'now')),
    status         SMALLINT      NOT NULL DEFAULT 1,
    create_date    INT           NOT NULL DEFAULT (strftime('%s', 'now'))
);

INSERT INTO shard (shard_id, shard_name, shard_type, schema_name, schema_path, node_id_origin, shard_date, node_signature) VALUES ("?shard_id", "?shard_name", "?shard_type", "?schema_name", "?schema_path", "?node_id_origin", ?shard_date, "?node_signature");

CREATE TABLE shard_attribute_type
(
    attribute_type_id CHAR(20)     NOT NULL PRIMARY KEY,
    attribute_type    VARCHAR(255) NOT NULL,
    status            SMALLINT     NOT NULL DEFAULT 1,
    create_date       INT          NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE shard_attribute
(
    shard_id          CHAR(49) NOT NULL,
    attribute_type_id CHAR(20) NOT NULL,
    value             TEXT     NOT NULL,
    status            SMALLINT NOT NULL DEFAULT 1,
    create_date       INT      NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (shard_id, attribute_type_id),
    FOREIGN KEY (shard_id) REFERENCES shard (shard_id),
    FOREIGN KEY (attribute_type_id) REFERENCES shard_attribute_type (attribute_type_id)
);

DROP TABLE IF EXISTS `transaction`;
DROP TABLE IF EXISTS transaction_parent;
DROP TABLE IF EXISTS transaction_signature;
DROP TABLE IF EXISTS transaction_input;
DROP TABLE IF EXISTS transaction_output;
DROP TABLE IF EXISTS transaction_output_attribute;
DROP TABLE IF EXISTS audit_verification;
DROP TABLE IF EXISTS audit_point;

COMMIT;
