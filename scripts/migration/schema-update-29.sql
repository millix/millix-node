PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

ALTER TABLE transaction_signature ADD COLUMN signer_data TEXT;

UPDATE schema_information SET value = "29" WHERE key = "version";

COMMIT;
