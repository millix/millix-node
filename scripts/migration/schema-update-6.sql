PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

UPDATE schema_information SET value = "6" WHERE key = "version";

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
CREATE INDEX idx_transaction_create_date ON `transaction` (create_date);

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
CREATE INDEX idx_transaction_parent_create_date ON transaction_parent (create_date);

CREATE TABLE transaction_signature
(
    transaction_id CHAR(44) NOT NULL,
    shard_id       CHAR(32) NOT NULL,
    address_base   CHAR(34) NOT NULL,
    signature      CHAR(44) NOT NULL,
    status         SMALLINT NOT NULL DEFAULT 1,
    create_date    INT      NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (transaction_id, address_base),
    FOREIGN KEY (transaction_id) REFERENCES `transaction` (transaction_id)
);
CREATE INDEX idx_transaction_signature_address ON transaction_signature (address_base);
CREATE INDEX idx_transaction_signature_create_date ON transaction_signature (create_date);

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
    FOREIGN KEY (transaction_id) REFERENCES `transaction` (transaction_id)
);
CREATE INDEX idx_transaction_input_address_key_identifier ON transaction_input (address_key_identifier);
CREATE INDEX idx_transaction_input_address_is_double_spend ON transaction_input (address, is_double_spend);
CREATE INDEX idx_transaction_input_transaction_id ON transaction_input (transaction_id);
CREATE INDEX idx_transaction_input_output_transaction_id_output_position ON transaction_input (output_transaction_id, output_position);
CREATE INDEX idx_transaction_input_create_date ON transaction_input (create_date);

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
    FOREIGN KEY (transaction_id) REFERENCES `transaction` (transaction_id)
);
CREATE INDEX idx_transaction_output_address_key_identifier ON transaction_output (address_key_identifier);
CREATE INDEX idx_transaction_output_address_is_spent ON transaction_output (address, is_spent);
CREATE INDEX idx_transaction_output_address_create_date ON transaction_output (address, create_date);
CREATE INDEX idx_transaction_output_address_is_stable_is_spent_is_double_spend ON transaction_output (address, is_stable, is_spent, is_double_spend);
CREATE INDEX idx_transaction_output_transaction_id_is_stable_is_double_spend ON transaction_output (transaction_id, is_stable, is_double_spend);
CREATE INDEX idx_transaction_output_transaction_id_is_spent ON transaction_output (transaction_id, is_spent);
CREATE INDEX idx_transaction_output_create_date ON transaction_output (create_date);


CREATE TABLE transaction_output_attribute
(
    transaction_output_id      CHAR(20) NOT NULL,
    transaction_output_type_id CHAR(20) NOT NULL,
    shard_id                   CHAR(32) NOT NULL,
    value                      TEXT     NOT NULL,
    status                     SMALLINT NOT NULL DEFAULT 1,
    create_date                INT      NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (transaction_output_id, transaction_output_type_id),
    FOREIGN KEY (transaction_output_id) REFERENCES transaction_output (transaction_id)
);
CREATE INDEX idx_transaction_output_attribute_create_date ON transaction_output_attribute (create_date);

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
CREATE INDEX idx_audit_verification_create_date ON audit_verification (create_date);

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
CREATE INDEX idx_audit_point_create_date ON audit_point (create_date);

COMMIT;
