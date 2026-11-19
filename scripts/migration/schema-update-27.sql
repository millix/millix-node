PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS cloud_notice
(
    notice_id             CHAR(50)    NOT NULL PRIMARY KEY CHECK (length(notice_id) <= 50),
    notice_type           CHAR(6)     NOT NULL CHECK (notice_type IN ('user', 'domain')),
    node_id               CHAR(34)    NOT NULL CHECK (length(node_id) <= 34),
    subject               CHAR(300)   NOT NULL CHECK (length(subject) <= 300),
    notice                TEXT        NOT NULL,
    anchor_transaction_id CHAR(50)    NOT NULL CHECK (length(anchor_transaction_id) <= 50),
    anchor_date           INT         NULL CHECK (anchor_date IS NULL OR (length(anchor_date) <= 10 AND TYPEOF(anchor_date) = 'integer')),
    status                TINYINT     NOT NULL DEFAULT 0 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    end_date              INT         NOT NULL CHECK (length(end_date) <= 10 AND TYPEOF(end_date) = 'integer'),
    create_date           INT         NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX IF NOT EXISTS idx_cloud_notice_subject ON cloud_notice (subject, status);
CREATE INDEX IF NOT EXISTS idx_cloud_notice_status ON cloud_notice (status);
CREATE INDEX IF NOT EXISTS idx_cloud_notice_end_date ON cloud_notice (end_date);

CREATE TABLE IF NOT EXISTS cloud_host
(
    node_id          CHAR(34)    NOT NULL PRIMARY KEY CHECK (length(node_id) <= 34),
    first_offer_date INT         NOT NULL CHECK (length(first_offer_date) <= 10 AND TYPEOF(first_offer_date) = 'integer'),
    last_offer_date  INT         NOT NULL CHECK (length(last_offer_date) <= 10 AND TYPEOF(last_offer_date) = 'integer')
);

UPDATE schema_information SET value = "27" WHERE key = "version";

COMMIT;
