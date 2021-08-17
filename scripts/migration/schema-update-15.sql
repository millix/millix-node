PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

DROP INDEX IF EXISTS idx_transaction_input_status_output_transaction_id;
DROP INDEX IF EXISTS idx_transaction_output_address_key_identifier_is_stable_is_spent_status;
DROP INDEX IF EXISTS idx_transaction_output_address_key_identifier_spent_double_spend_status;
CREATE INDEX idx_transaction_input_status_output_transaction_id ON transaction_input (status, output_transaction_id);
CREATE INDEX idx_transaction_output_address_key_identifier_is_stable_is_spent_status ON transaction_output (address_key_identifier, is_stable, is_spent, status);
CREATE INDEX idx_transaction_output_address_key_identifier_spent_double_spend_status ON transaction_output (address_key_identifier, is_spent, is_double_spend, status);

UPDATE schema_information SET value = "15" WHERE key = "version";

COMMIT;
