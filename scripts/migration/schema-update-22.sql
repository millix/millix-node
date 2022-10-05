PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

INSERT OR IGNORE INTO normalization (normalization_name, normalization_id)
VALUES ('wallet_aggregation_auto_enabled', 'n2aXBpCWhSVHx8kl8lwj'),
       ('wallet_aggregation_auto_output_min', 'Q1Ok1vhMqDsKNrADxbhh');

UPDATE schema_information SET value = "22" WHERE key = "version";

COMMIT;
