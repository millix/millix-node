PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

INSERT OR REPLACE INTO normalization (normalization_name, normalization_id)
VALUES ('transaction_output_metadata', 'Adl87cz8kC190Nqc');

UPDATE schema_information SET value = "19" WHERE key = "version";

COMMIT;
