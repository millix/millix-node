PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

UPDATE schema_information SET value = "5" WHERE key = "version";

CREATE INDEX IF NOT EXISTS idx_transaction_create_date ON `transaction` (create_date);
CREATE INDEX IF NOT EXISTS idx_transaction_parent_create_date ON transaction_parent (create_date);
CREATE INDEX IF NOT EXISTS idx_transaction_signature_create_date ON transaction_signature (create_date);
CREATE INDEX IF NOT EXISTS idx_transaction_input_create_date ON transaction_input (create_date);
CREATE INDEX IF NOT EXISTS idx_transaction_output_create_date ON transaction_output (create_date);
CREATE INDEX IF NOT EXISTS idx_transaction_output_attribute_create_date ON transaction_output_attribute (create_date);
CREATE INDEX IF NOT EXISTS idx_audit_verification_create_date ON audit_verification (create_date);
CREATE INDEX IF NOT EXISTS idx_audit_point_create_date ON audit_point (create_date);

COMMIT;
