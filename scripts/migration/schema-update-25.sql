PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

INSERT OR REPLACE INTO address_version ('version', 'is_main_network', 'regex_pattern', 'is_default')
VALUES ('0e0', 1, '(?<address>.*)(?<version>0e0)(?<identifier>.*)', 0);

INSERT OR REPLACE INTO address_version ('version', 'is_main_network', 'regex_pattern', 'is_default')
VALUES ('lel', 0, '(?<address>.*)(?<version>lel)(?<identifier>.*)', 0);

CREATE TABLE IF NOT EXISTS escrow
(
    escrow_address         CHAR(72)    NOT NULL PRIMARY KEY CHECK (length(escrow_address) <= 72),
    address_base           CHAR(34)    NOT NULL CHECK (length(address_base) <= 34),
    role                   CHAR(5)     NOT NULL CHECK (role IN ('payer', 'payee')),
    node_id                CHAR(34)    NOT NULL CHECK (length(node_id) <= 34),
    terms                  TEXT        NOT NULL,
    funding_transaction_id CHAR(50)    NULL CHECK (length(funding_transaction_id) <= 50),
    receipt                TEXT        NULL,
    receipt_signature      TEXT        NULL,
    receipt_total_bytes    INT         NOT NULL DEFAULT 0 CHECK (TYPEOF(receipt_total_bytes) = 'integer'),
    receipt_sequence       INT         NOT NULL DEFAULT 0 CHECK (TYPEOF(receipt_sequence) = 'integer'),
    unlock_date            INT         NOT NULL CHECK (length(unlock_date) <= 10 AND TYPEOF(unlock_date) = 'integer'),
    status                 TINYINT     NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date            INT         NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX IF NOT EXISTS idx_escrow_role_status ON escrow (role, status);
CREATE INDEX IF NOT EXISTS idx_escrow_create_date ON escrow (create_date);

UPDATE schema_information SET value = "25" WHERE key = "version";

COMMIT;
