PRAGMA foreign_keys=off;

BEGIN TRANSACTION;

UPDATE schema_information SET value = "3" WHERE key = "version";

ALTER TABLE node RENAME TO _node_old;

CREATE TABLE node
(
    node_id         CHAR(34)    NULL CHECK (length(node_id) <= 34),
    node_prefix     CHAR(10)    NOT NULL CHECK (length(node_prefix) <= 10),
    node_ip_address CHAR(45)    NOT NULL CHECK (length(node_ip_address) <= 45),
    node_port       INT         NOT NULL CHECK (length(node_port) <= 10 AND TYPEOF(node_port) = 'integer'),
    node_port_api   INT         NOT NULL CHECK (length(node_port_api) <= 10 AND TYPEOF(node_port_api) = 'integer'),
    status          TINYINT     NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    update_date     INT         NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(update_date) <= 10 AND TYPEOF(update_date) = 'integer'),
    create_date     INT         NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer'),
    PRIMARY KEY (node_prefix, node_ip_address, node_port)
);
CREATE INDEX idx_node_create_date ON node (create_date);

INSERT INTO node (node_id, node_prefix, node_ip_address, node_port, node_port_api, status, update_date, create_date)
  SELECT node_id, "wss://", node_ip_address, node_port, 0, status, update_date, create_date
  FROM _node_old;

DROP TABLE _node_old;

ALTER TABLE node_attribute RENAME TO _node_attribute_old;

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

INSERT INTO node_attribute (node_id, attribute_type_id, value, status, create_date)
  SELECT node_id, attribute_type_id, value, status, create_date
  FROM _node_attribute_old;

DROP TABLE _node_attribute_old;

DELETE FROM api;
DELETE FROM config where config_name = 'node_initial_list';
UPDATE config SET value = 'wss://' where config_name = 'websocket_protocol';
COMMIT;
