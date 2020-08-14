PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

UPDATE schema_information SET value = "8" WHERE key = "version";

INSERT INTO object (object_name, object_id)
VALUES ('peer_rotation_more_than_average', 'Z2z0wVCm6Ai1p7OG4MfN'),
       ('peer_rotation_more_than_most', 'hVEmlU6bL4l3DNeOhdM3'),
       ('peer_rotation_more_than_all', 'wpwt2V5vrT28ngz9u3J3'),
       ('peer_rotation_config', 'H2ODFHCxOl1FErIqCDqG'),
       ('shard_zero_name', 'rMSuKEh42OZaeVEgzG62');

UPDATE config SET config_id = (SELECT object_id FROM object WHERE object_name = config_name) WHERE config_name IN (SELECT object_name FROM object WHERE object_name = config_name);

COMMIT;
