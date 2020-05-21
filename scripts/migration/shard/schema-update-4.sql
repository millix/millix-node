PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

UPDATE schema_information SET value = "4" WHERE key = "version";

DROP TABLE IF EXISTS address;
DROP TABLE IF EXISTS address_version;
DROP TABLE IF EXISTS api;
DROP TABLE IF EXISTS config;
DROP TABLE IF EXISTS keychain;
DROP TABLE IF EXISTS keychain_address;
DROP TABLE IF EXISTS node;
DROP TABLE IF EXISTS node_attribute;
DROP TABLE IF EXISTS node_attribute_type;
DROP TABLE IF EXISTS transaction_output_type;
DROP TABLE IF EXISTS wallet;

COMMIT;
