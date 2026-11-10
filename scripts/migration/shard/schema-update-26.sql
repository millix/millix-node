PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

UPDATE schema_information SET value = "26" WHERE key = "version";

COMMIT;
