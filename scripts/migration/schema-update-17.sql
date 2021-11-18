PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

CREATE INDEX idx_transaction_output_transaction_id_address_key_identifier ON transaction_output (transaction_id, address_key_identifier);

UPDATE schema_information SET value = "17" WHERE key = "version";

COMMIT;
