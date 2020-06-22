PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

UPDATE schema_information SET value = "7" WHERE key = "version";
INSERT INTO node_attribute_type (attribute_type_id, attribute_type) VALUES ('useBqrZ9F8Gv6aVH85pB', 'peer_rotation_settings');
INSERT INTO node_attribute (node_id, attribute_type_id, value) VALUES ('?node_id', 'useBqrZ9F8Gv6aVH85pB', '{"PROACTIVE": { "frequency": 0.7, "DATA_QUANTITY": { "frequency": 0.25, "random_set_length": "PEER_ROTATION_MORE_THAN_AVERAGE" }, "POPULARITY": { "frequency": 0.25, "random_set_length": "PEER_ROTATION_MORE_THAN_AVERAGE" }, "RANDOM": { "frequency": 0.5 } }, "REACTIVE": { "frequency": 0.3 } }');
COMMIT;
