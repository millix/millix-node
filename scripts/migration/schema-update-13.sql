PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

INSERT OR IGNORE INTO normalization (normalization_name, normalization_id)
VALUES ('node_public_key', 'KkwWuh5VaHBYlk8lsduD'),
       ('peer_count', 'OfhGqiGJID8WTOZHzl2b'),
       ('shard_protocol', 'kbkMAkuyqOlSNKv7udFz'),
       ('transaction_count', 'qhTfPzLhZENklxNbTQYW');

UPDATE node_attribute SET attribute_type_id = coalesce((SELECT normalization_id FROM normalization WHERE normalization_name = (SELECT attribute_type FROM node_attribute_type WHERE attribute_type_id = node_attribute.attribute_type_id)), attribute_type_id);
UPDATE node_attribute_type SET attribute_type_id = (SELECT normalization_id FROM normalization WHERE normalization_name = attribute_type) WHERE attribute_type IN (SELECT normalization_name FROM normalization);

UPDATE schema_information SET value = "13" WHERE key = "version";

COMMIT;
