PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

DELETE FROM node_attribute;

DROP TABLE IF EXISTS node;

CREATE TABLE node
(
    node_id         CHAR(34)    NOT NULL PRIMARY KEY CHECK (length(node_id) <= 34),
    node_prefix     CHAR(10)    NOT NULL CHECK (length(node_prefix) <= 10),
    node_address    CHAR(45)    NOT NULL CHECK (length(node_address) <= 45),
    node_port       INT         NOT NULL CHECK (length(node_port) <= 10 AND TYPEOF(node_port) = 'integer'),
    node_port_api   INT         NOT NULL CHECK (length(node_port_api) <= 10 AND TYPEOF(node_port_api) = 'integer'),
    status          TINYINT     NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    update_date     INT         NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(update_date) <= 10 AND TYPEOF(update_date) = 'integer'),
    create_date     INT         NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_node_create_date ON node (create_date);

INSERT OR IGNORE INTO normalization (normalization_name, normalization_id)
VALUES ('node_key_public', 'GKj5UNJmpx5qCGQnaJjA'),
       ('node_bind_ip', 'Apw9ovpclfW6LvSVYqYD');

UPDATE schema_information SET value = "10" WHERE key = "version";

COMMIT;
