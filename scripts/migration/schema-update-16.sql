PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

DROP TABLE IF EXISTS audit_verification;
DROP TABLE IF EXISTS audit_point;

DELETE FROM normalization WHERE normalization_name IN ('audit_point_node_count', 'audit_point_validation_required',
                                                      'audit_point_attempt_max', 'audit_point_candidate_max',
                                                      'audit_point_validation_wait_time_max', 'audit_point_prune_age_min' ,
                                                      'audit_point_prune_count', 'audit_point_transaction_prune_age_min',
                                                      'audit_point_transaction_prune_count', 'wallet_spent_transaction_prune');
DELETE FROM api WHERE api_id IN ('DBkGHZX6rugdLon9', 'VrLU9f2XYiMWfop4');

UPDATE schema_information SET value = "16" WHERE key = "version";

COMMIT;
