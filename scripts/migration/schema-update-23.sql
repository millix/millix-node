PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

INSERT OR REPLACE INTO address_version ('version', 'is_main_network', 'regex_pattern', 'is_default')
VALUES ('0d0', 1, '(?<address>.*)(?<version>0d0)(?<identifier>.*)', 0);

INSERT OR REPLACE INTO address_version ('version', 'is_main_network', 'regex_pattern', 'is_default')
VALUES ('ldl', 0, '(?<address>.*)(?<version>ldl)(?<identifier>.*)', 0);

UPDATE schema_information SET value = "23" WHERE key = "version";

COMMIT;
