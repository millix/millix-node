PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

INSERT OR REPLACE INTO normalization (normalization_name, normalization_id)
VALUES ('transaction_fee_proxy', 'qTCYsDQzIoVbaX8iIjry'),
       ('transaction_fee_network', '9hJcCunmEibhDgoLHzC8'),
       ('transaction_fee_default', 'eoSDGGFKD3dYfcKF1nFO');

UPDATE config SET config_name='transaction_fee_proxy', config_id='qTCYsDQzIoVbaX8iIjry', value='1000' WHERE config_name='transaction_fee_proxy';
UPDATE config SET config_name='transaction_fee_network', config_id='9hJcCunmEibhDgoLHzC8', value='0' WHERE config_name='transaction_fee_network';
UPDATE config SET config_name='transaction_fee_default', config_id='eoSDGGFKD3dYfcKF1nFO', value='1000' WHERE config_name='transaction_fee_default';

UPDATE schema_information SET value = "14" WHERE key = "version";

COMMIT;
