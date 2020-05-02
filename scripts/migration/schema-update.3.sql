PRAGMA foreign_keys=off;

BEGIN TRANSACTION;

UPDATE schema_information SET value = "3" WHERE key = "version";

ALTER TABLE node RENAME TO _node_old;

CREATE TABLE node
(
    node_id         CHAR(32) NULL,
    node_prefix     VARCHAR(10) NOT NULL,
    node_ip_address VARCHAR(45) NOT NULL,
    node_port       INT         NOT NULL,
    node_port_api   INT         NOT NULL,
    status          SMALLINT    NOT NULL DEFAULT 1,
    update_date     INT         NOT NULL DEFAULT (strftime('%s', 'now')),
    create_date     INT         NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (node_prefix, node_ip_address, node_port)
);

INSERT INTO node (node_id, node_prefix, node_ip_address, node_port, node_port_api, status, update_date, create_date)
  SELECT node_id, node_prefix, node_ip_address, node_port, 0, status, update_date, create_date
  FROM _node_old;

DROP TABLE _node_old;

ALTER TABLE node_attribute RENAME TO _node_attribute_old;

CREATE TABLE node_attribute
(
    node_id           CHAR(32) NOT NULL,
    attribute_type_id CHAR(20) NOT NULL,
    value             TEXT     NOT NULL,
    status            SMALLINT NOT NULL DEFAULT 1,
    create_date       INT      NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (node_id, attribute_type_id),
    FOREIGN KEY (node_id) REFERENCES node (node_id),
    FOREIGN KEY (attribute_type_id) REFERENCES node_attribute_type (attribute_type_id)
);

INSERT INTO node_attribute (node_id, attribute_type_id, value, status, create_date)
  SELECT node_id, attribute_type_id, value, status, create_date
  FROM _node_attribute_old;

DROP TABLE _node_attribute_old;

DELETE FROM api;

COMMIT;

PRAGMA foreign_keys=on;
