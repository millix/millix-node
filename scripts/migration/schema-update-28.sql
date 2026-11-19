PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

ALTER TABLE cloud_broker_certificate ADD COLUMN is_trial TINYINT NOT NULL DEFAULT 0 CHECK (is_trial IN (0, 1));
ALTER TABLE cloud_broker_certificate ADD COLUMN payment_amount BIGINT NULL CHECK (payment_amount IS NULL OR TYPEOF(payment_amount) = 'integer');
CREATE INDEX IF NOT EXISTS idx_cloud_broker_certificate_is_trial ON cloud_broker_certificate (is_trial);

ALTER TABLE cloud_broker_host ADD COLUMN amount_paid_trial BIGINT NOT NULL DEFAULT 0 CHECK (TYPEOF(amount_paid_trial) = 'integer');

ALTER TABLE cloud_broker_payout ADD COLUMN amount_trial BIGINT NOT NULL DEFAULT 0 CHECK (TYPEOF(amount_trial) = 'integer');

CREATE TABLE IF NOT EXISTS cloud_broker_trial_block
(
    node_id     CHAR(34)    NOT NULL PRIMARY KEY CHECK (length(node_id) <= 34),
    create_date INT         NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);

UPDATE schema_information SET value = "28" WHERE key = "version";

COMMIT;
