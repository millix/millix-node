PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS cloud_broker_certificate
(
    certificate_id         CHAR(50)    NOT NULL PRIMARY KEY CHECK (length(certificate_id) <= 50),
    funding_transaction_id CHAR(50)    NOT NULL UNIQUE CHECK (length(funding_transaction_id) <= 50),
    holder_public_key      CHAR(45)    NOT NULL CHECK (length(holder_public_key) <= 45),
    certificate            TEXT        NOT NULL,
    piece_issued_count     INT         NOT NULL DEFAULT 0 CHECK (TYPEOF(piece_issued_count) = 'integer'),
    end_date               INT         NOT NULL CHECK (length(end_date) <= 10 AND TYPEOF(end_date) = 'integer'),
    create_date            INT         NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX IF NOT EXISTS idx_cloud_broker_certificate_create_date ON cloud_broker_certificate (create_date);

CREATE TABLE IF NOT EXISTS cloud_broker_receipt
(
    certificate_id     CHAR(50)    NOT NULL CHECK (length(certificate_id) <= 50),
    node_id            CHAR(34)    NOT NULL CHECK (length(node_id) <= 34),
    piece_index        INT         NOT NULL CHECK (TYPEOF(piece_index) = 'integer'),
    total_bytes        INT         NOT NULL CHECK (TYPEOF(total_bytes) = 'integer'),
    sequence           INT         NOT NULL CHECK (TYPEOF(sequence) = 'integer'),
    receipt            TEXT        NOT NULL,
    receipt_signature  TEXT        NOT NULL,
    first_receipt_date INT         NOT NULL CHECK (length(first_receipt_date) <= 10 AND TYPEOF(first_receipt_date) = 'integer'),
    update_date        INT         NOT NULL CHECK (length(update_date) <= 10 AND TYPEOF(update_date) = 'integer'),
    PRIMARY KEY (certificate_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_cloud_broker_receipt_node_id ON cloud_broker_receipt (node_id);

CREATE TABLE IF NOT EXISTS cloud_broker_host
(
    node_id        CHAR(34)    NOT NULL PRIMARY KEY CHECK (length(node_id) <= 34),
    payout_address CHAR(72)    NOT NULL CHECK (length(payout_address) <= 72),
    amount_paid    BIGINT      NOT NULL DEFAULT 0 CHECK (TYPEOF(amount_paid) = 'integer'),
    update_date    INT         NOT NULL CHECK (length(update_date) <= 10 AND TYPEOF(update_date) = 'integer'),
    create_date    INT         NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);

CREATE TABLE IF NOT EXISTS cloud_broker_payout
(
    transaction_id CHAR(50)    NOT NULL CHECK (length(transaction_id) <= 50),
    node_id        CHAR(34)    NOT NULL CHECK (length(node_id) <= 34),
    amount         BIGINT      NOT NULL CHECK (TYPEOF(amount) = 'integer'),
    create_date    INT         NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer'),
    PRIMARY KEY (transaction_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_cloud_broker_payout_node_id ON cloud_broker_payout (node_id);

CREATE TABLE IF NOT EXISTS cloud_pass
(
    pass_id                CHAR(32)    NOT NULL PRIMARY KEY CHECK (length(pass_id) <= 32),
    broker_address         CHAR(72)    NOT NULL CHECK (length(broker_address) <= 72),
    holder_public_key      CHAR(45)    NOT NULL CHECK (length(holder_public_key) <= 45),
    funding_transaction_id CHAR(50)    NULL CHECK (length(funding_transaction_id) <= 50),
    certificate_id         CHAR(50)    NULL UNIQUE CHECK (length(certificate_id) <= 50),
    certificate            TEXT        NULL,
    piece_list             TEXT        NOT NULL DEFAULT '[]',
    status                 CHAR(10)    NOT NULL CHECK (length(status) <= 10),
    create_date            INT         NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX IF NOT EXISTS idx_cloud_pass_status ON cloud_pass (status);

CREATE TABLE IF NOT EXISTS cloud_vpn_certificate
(
    certificate_id      CHAR(50)    NOT NULL PRIMARY KEY CHECK (length(certificate_id) <= 50),
    broker_address      CHAR(72)    NOT NULL CHECK (length(broker_address) <= 72),
    certificate         TEXT        NOT NULL,
    piece_index_list    TEXT        NOT NULL DEFAULT '[]',
    receipt             TEXT        NULL,
    receipt_signature   TEXT        NULL,
    receipt_total_bytes INT         NOT NULL DEFAULT 0 CHECK (TYPEOF(receipt_total_bytes) = 'integer'),
    receipt_sequence    INT         NOT NULL DEFAULT 0 CHECK (TYPEOF(receipt_sequence) = 'integer'),
    reported_sequence   INT         NOT NULL DEFAULT 0 CHECK (TYPEOF(reported_sequence) = 'integer'),
    end_date            INT         NOT NULL CHECK (length(end_date) <= 10 AND TYPEOF(end_date) = 'integer'),
    create_date         INT         NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX IF NOT EXISTS idx_cloud_vpn_certificate_reported ON cloud_vpn_certificate (receipt_sequence, reported_sequence);

UPDATE schema_information SET value = "26" WHERE key = "version";

COMMIT;
