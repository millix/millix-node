PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

INSERT OR REPLACE INTO address_version ('version', 'is_main_network', 'regex_pattern', 'is_default')
VALUES ('0c0', 1, '(?<address>.*)(?<version>0c0)(?<identifier>.*)', 0);

INSERT OR REPLACE INTO address_version ('version', 'is_main_network', 'regex_pattern', 'is_default')
VALUES ('lcl', 0, '(?<address>.*)(?<version>lcl)(?<identifier>.*)', 0);

UPDATE schema_information SET value = "20" WHERE key = "version";

COMMIT;
