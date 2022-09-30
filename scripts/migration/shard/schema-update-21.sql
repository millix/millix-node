PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

CREATE INDEX IF NOT EXISTS idx_transaction_output_address_key_identifier_create_date ON transaction_output (address_key_identifier, create_date);
UPDATE schema_information SET value = "21" WHERE key = "version";

COMMIT;
