PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

DROP TABLE IF EXISTS audit_verification;
DROP TABLE IF EXISTS audit_point;

UPDATE schema_information SET value = "16" WHERE key = "version";

COMMIT;
