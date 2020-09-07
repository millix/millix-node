PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

UPDATE schema_information
SET value = "5"
WHERE key = "version";

CREATE INDEX IF NOT EXISTS idx_wallet_create_date ON wallet (create_date);
CREATE INDEX IF NOT EXISTS idx_keychain_create_date ON keychain (create_date);
CREATE INDEX IF NOT EXISTS idx_keychain_address_create_date ON keychain_address (create_date);
CREATE INDEX IF NOT EXISTS idx_address_create_date ON address (create_date);
CREATE INDEX IF NOT EXISTS idx_transaction_output_type_create_date ON transaction_output_type (create_date);
CREATE INDEX IF NOT EXISTS idx_node_create_date ON node (create_date);
CREATE INDEX IF NOT EXISTS idx_node_attribute_create_date ON node_attribute (create_date);
CREATE INDEX IF NOT EXISTS idx_node_attribute_type_create_date ON node_attribute_type (create_date);
CREATE INDEX IF NOT EXISTS idx_config_create_date ON config (create_date);
CREATE INDEX IF NOT EXISTS idx_schema_information_create_date ON schema_information (create_date);
CREATE INDEX IF NOT EXISTS idx_address_version_create_date ON address_version (create_date);


CREATE TABLE object
(
    object_id   CHAR(20)     NOT NULL PRIMARY KEY,
    object_name VARCHAR(255) NOT NULL UNIQUE,
    status      SMALLINT     NOT NULL DEFAULT 1,
    create_date INT          NOT NULL DEFAULT (strftime('%s', 'now'))
);


INSERT INTO object (object_name, object_id)
VALUES ('mode_debug', 'AK5rcMMbWw5xIfXVdRVL'),
       ('mode_test_network', 'mHUyg4ZLca4mt7umomEW'),
       ('node_port', 'A4FpnTLmqGSH7nvU9j4x'),
       ('node_port_api', '3rCLWGPWIhqgnjWp5EtV'),
       ('node_host', 'yIarmjiV0B7KgefJI5Kr'),
       ('websocket_protocol', '72lDSYwxagTBZz3ZFxI4'),
       ('rpc_interface', 'CIn93tK47ywajdrlsYxv'),
       ('node_public', '9NUpixQHFRL0Ij6vz1lA'),
       ('node_initial_list_main_network', 'TwWXH3VSHGRhCdRC64Y5'),
       ('node_initial_list_test_network', 'ljXQvhkeXv8dyUCmcGMF'),
       ('node_initial_list', '5aYWBvK3RlMMlM2SHjbO'),
       ('consensus_round_node_count', 'BCtRYOLJ82Zou0HbGwbE'),
       ('consensus_round_validation_required', '5dZrGlCiE7fhZwWplVgv'),
       ('consensus_round_validation_max', '8iM6bSsJ4XGknV6kUtVM'),
       ('consensus_round_not_found_max', 'TcsDuXPzfOCSSAHsNW6U'),
       ('consensus_round_double_spend_max', '6kxA1HYsXx4fYEsJDWZr'),
       ('consensus_validation_depth_max', '0i9B8K4WrfZlBO9xzdMM'),
       ('consensus_validation_request_depth_max', 'Zzh8JnPGTOsi9ZaJHFng'),
       ('consensus_validation_wait_time_max', 'DBvU4CSipttmG9SCn1Lo'),
       ('consensus_validation_retry_wait_time', 'JMDLznR9sfSyuwfK1R5G'),
       ('audit_point_node_count', 'd0AdtgtixzR9kzkBQPcq'),
       ('audit_point_validation_required', 'xFLwHUYVv0wXobL9PHQx'),
       ('audit_point_attempt_max', 'lsGYeBDXlV0RtbQQsbQM'),
       ('audit_point_candidate_max', 'choXy0Pw36SXe11zhLlb'),
       ('audit_point_validation_wait_time_max', 'egtSGgi8rpTp2mPyygxB'),
       ('audit_point_prune_age_min', 'Tc5XEz5adhQgxCty0owc'),
       ('audit_point_prune_count', 'ppYWpWWWR4xasfJsGjIg'),
       ('audit_point_transaction_prune_age_min', 'KICCmcRm8tVL5N1aElIG'),
       ('audit_point_transaction_prune_count', 'xDWevh5eg8DWb4UGEIIX'),
       ('node_connection_inbound_max', 'of16lAY1fS7K9K7ufSDR'),
       ('node_connection_outbound_max', 'b7qm0K1dHuu00nmIgwCR'),
       ('heartbeat_timeout', 'IvKT7CLUhiUvQ4W286TM'),
       ('heartbeat_response_timeout', 'NUTODkCDasmliuHDQuGF'),
       ('wallet_startup_address_balance_scan_count', 'tlCRczQCuztpgMbAsWIA'),
       ('wallet_log_size_max', 'EdAFKivNnHLl9jIrVSHT'),
       ('wallet_transaction_default_version', 'O3bneunmkY2tbqa1FOVp'),
       ('wallet_spent_transaction_prune', 'G9P5HLCgZWyl8hdT8bxy'),
       ('wallet_transaction_queue_size_max', 'dbdTZKYgnIJgpkq0r7K7'),
       ('wallet_transaction_queue_size_normal', 'FlzDh0b1QlEpOAERQatJ'),
       ('network_long_time_wait_max', 'qvSfStkxR5BKWbYlbQxA'),
       ('network_short_time_wait_max', 'EYAbwP2MDkqYgpIwvUeL'),
       ('database_engine', '7cqxMOo2vMfr8oQGUi3R'),
       ('database_connection', 'wcFVmxvQQM7XdTtrSOpJ'),
       ('millix_circulation', 'EjPRFNdkNJGb8WFr4RkF'),
       ('mode_test', '1ReNaaJHFoaursWbgEnb'),
       ('node_test_host', 'iVcXf6042sKwNQ17YvrQ'),
       ('node_test_port', 'BPkvfTYL4QRmuYtOpt0e'),
       ('hash_length', 'FsQpz2NOyByeBShgSDHf'),
       ('pubkey_length', 'LK2HWftEkTse5DGpY2e7'),
       ('sig_length', 'HKTKAwiUb6xZ48Gfo6Ls'),
       ('node_millix_version', 'ZqKGkHGpChkHfdwBhMJx'),
       ('data_base_dir_main_network', 'h7bOhKpGWtR5y9gkUBqG'),
       ('data_base_dir_test_network', '1b9W3r8XqBoj7Yntr71P'),
       ('node_key_path', '1dBK9jRTqK4r6SKAgb3r'),
       ('node_certificate_key_path', 'n7W8tfvrrCewkCNxQylw'),
       ('node_certificate_path', 'tRuUYRNdJDoeaWkWZzb2'),
       ('wallet_key_path', 'eGs9xpLg5IhnuNWTrDwp'),
       ('job_config_path', 'kixVXMz7RUxUKIgOn8Ii');

UPDATE config
SET config_id = (SELECT object_id FROM object WHERE object_name = config_name)
WHERE config_name IN (SELECT object_name FROM object WHERE object_name = config_name);

COMMIT;
