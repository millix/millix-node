PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

UPDATE schema_information SET value = "9" WHERE key = "version";


CREATE TABLE trigger
(
    id         CHAR(32) NOT NULL UNIQUE,
    trigger_name       VARCHAR(200) NOT NULL UNIQUE,
    trigger_type      CHAR(32)     NOT NULL,
    object_guid CHAR(32),
    object_key VARCHAR(200),
    shard_id CHAR(32),
    data_source VARCHAR(1000),
    data_source_type VARCHAR(1000),
    data_source_variable VARCHAR(4000),
    variable_1 VARCHAR(200),
    variable_2 VARCHAR(200),
    variable_operator VARCHAR(45),
    last_trigger_state TINYINT NOT NULL DEFAULT 0,
    allow_adhoc TINYINT NOT NULL DEFAULT 0,
    status TINYINT NOT NULL DEFAULT 1,
    create_date INT          NOT NULL DEFAULT (strftime('%s', 'now'))
    update_date INT          NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE trigger_action
(
    id         CHAR(32)      NOT NULL UNIQUE,
    trigger_id CHAR(32) NOT NULL,
    name CHAR(200) NOT NULL UNIQUE,
    trigger_result VARCHAR(1000) NOT NULL,
    action VARCHAR(1000)  NOT NULL,
    action_variable VARCHAR(4000),
    last_action_message VARCHAR(1000),
    last_action_date INT,
    priority SMALLINT(6) NOT NULL DEFAULT 0,
    status          SMALLINT     NOT NULL DEFAULT 1,
    create_date     INT          NOT NULL DEFAULT (strftime('%s', 'now'))
    update_date INT          NOT NULL DEFAULT (strftime('%s', 'now'))
    FOREIGN KEY (trigger_id) references trigger(id) ON DELETE CASCADE,
);


COMMIT;
