PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

UPDATE schema_information SET value = "4" WHERE key = "version";

DROP TABLE address;
DROP TABLE address_version;
DROP TABLE api;
DROP TABLE config;
DROP TABLE keychain;
DROP TABLE keychain_address;
DROP TABLE node;
DROP TABLE node_attribute;
DROP TABLE node_attribute_type;
DROP TABLE transaction_output_type;
DROP TABLE wallet;

COMMIT;
