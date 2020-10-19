PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

CREATE TABLE new_transaction_input
(
    transaction_id          CHAR(50) NOT NULL CHECK (length(transaction_id) <= 50),
    shard_id                CHAR(50) NOT NULL CHECK (length(shard_id) <= 50),
    input_position          TINYINT  NOT NULL CHECK (length(input_position) <= 3 AND TYPEOF(input_position) = 'integer'),
    output_transaction_id   CHAR(50) NULL CHECK (length(output_transaction_id) <= 50),
    output_position         TINYINT  NULL CHECK(length(output_position) <= 3 AND TYPEOF(output_position) IN ('integer', 'null')),
    output_shard_id         CHAR(50) NULL CHECK (length(output_shard_id) <= 50),
    output_transaction_date INT      NULL CHECK(length(output_transaction_date) <= 10 AND TYPEOF(output_transaction_date) IN ('integer', 'null')),
    double_spend_date       INT      NULL CHECK(length(double_spend_date) <= 10 AND TYPEOF(double_spend_date) IN ('integer', 'null')),
    is_double_spend         TINYINT  NULL DEFAULT 0 CHECK (is_double_spend = 0 OR is_double_spend = 1 OR is_double_spend IS NULL),
    address                 CHAR(72) NULL CHECK (length(address) <= 72),
    address_key_identifier  CHAR(34) NULL CHECK (length(address_key_identifier) <= 34),
    status                  TINYINT  NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date             INT      NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer'),
    PRIMARY KEY (transaction_id, input_position),
    FOREIGN KEY (transaction_id) REFERENCES `transaction` (transaction_id),
    FOREIGN KEY (address, address_key_identifier) REFERENCES address (address, address_key_identifier)
);
INSERT INTO new_transaction_input SELECT * FROM transaction_input;
DROP TABLE transaction_input;
ALTER TABLE new_transaction_input RENAME TO transaction_input;

CREATE INDEX idx_transaction_input_address_key_identifier ON transaction_input (address_key_identifier);
CREATE INDEX idx_transaction_input_address_is_double_spend ON transaction_input (address, is_double_spend);
CREATE INDEX idx_transaction_input_transaction_id ON transaction_input (transaction_id);
CREATE INDEX idx_transaction_input_output_transaction_id_output_position ON transaction_input (output_transaction_id, output_position);
CREATE INDEX idx_transaction_input_create_date ON transaction_input (create_date);

UPDATE schema_information SET value = "11" WHERE key = "version";

COMMIT;
