PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

ALTER TABLE transaction_signature ADD COLUMN signer_data TEXT;

-- reset the validation status of every transaction created between 1795249160 and 1795744285 (same as transaction repository resetTransaction)
UPDATE transaction_input SET double_spend_date = NULL, is_double_spend = 0, status = 1 WHERE transaction_id IN (SELECT transaction_id FROM `transaction` WHERE transaction_date BETWEEN 1795249160 AND 1795744285);
UPDATE transaction_output SET stable_date = NULL, is_stable = 0, spent_date = NULL, is_spent = 0, double_spend_date = NULL, is_double_spend = 0, status = 1 WHERE transaction_id IN (SELECT transaction_id FROM `transaction` WHERE transaction_date BETWEEN 1795249160 AND 1795744285);
UPDATE `transaction` SET stable_date = NULL, is_stable = 0, status = 1 WHERE transaction_date BETWEEN 1795249160 AND 1795744285;

UPDATE schema_information SET value = "29" WHERE key = "version";

COMMIT;
