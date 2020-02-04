-- -----------------------
-- object table
CREATE TABLE object
(
    object_id         CHAR(44)     NOT NULL PRIMARY KEY,
    object_name       VARCHAR(50)  NOT NULL,
    object_name_field VARCHAR(50)  NULL,
    object_key        VARCHAR(50)  NULL,
    object_type       VARCHAR(50)  NULL,
    id_length         VARCHAR(50)  NULL,
    search_prefix     VARCHAR(50)  NULL,
    time_to_live      INT          NULL,
    allow_prune       SMALLINT     NOT NULL DEFAULT 0,
    allow_list        SMALLINT     NOT NULL DEFAULT 1,
    conn_string       VARCHAR(255) NULL,
    status            SMALLINT     NOT NULL DEFAULT 1,
    create_date       INT          NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- -----------------------
-- job type table
CREATE TABLE job_type
(
    job_type_id CHAR(44)    NOT NULL PRIMARY KEY,
    job_type    VARCHAR(50) NOT NULL,
    status      SMALLINT    NOT NULL DEFAULT 1,
    create_date INT         NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- -----------------------
-- job group table
CREATE TABLE job_group
(
    job_group_id   CHAR(44)           NOT NULL PRIMARY KEY,
    job_group_name VARCHAR(50) UNIQUE NOT NULL,
    status         SMALLINT           NOT NULL DEFAULT 1,
    create_date    INT                NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- -----------------------
-- job processor table
CREATE TABLE job_processor
(
    processor_id CHAR(44)    NOT NULL PRIMARY KEY,
    ip_address   VARCHAR(50) NOT NULL,
    port         INT         NULL,
    rpc_user     VARCHAR(50) NULL,
    rpc_password VARCHAR(50) NULL,
    status       SMALLINT    NOT NULL DEFAULT 1,
    create_date  INT         NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE (ip_address, port, rpc_user)
);

-- -----------------------
-- job table
CREATE TABLE job
(
    job_id          CHAR(44)           NOT NULL PRIMARY KEY,
    job_name        VARCHAR(50) UNIQUE NOT NULL,
    processor_id    CHAR(44)           NOT NULL,
    job_group_id    CHAR(44)           NOT NULL,
    job_type_id     CHAR(44)           NOT NULL,
    job_payload     TEXT               NOT NULL,
    timeout         INT                NOT NULL DEFAULT 0,
    run_always      SMALLINT           NOT NULL DEFAULT 0,
    run_every       INT                NULL,
    run_on_the      INT                NULL,
    run_at          CHAR(7)            NULL, -- hh:mm:ss
    run_delay       INT                NOT NULL DEFAULT 0,
    run_date        TEXT               NULL, -- day of the month
    in_progress     SMALLINT           NOT NULL DEFAULT 0,
    last_date_begin INT                NULL,
    last_date_end   INT                NULL,
    last_elapse     INT                NULL,
    last_response   TEXT               NULL,
    priority        INT                NOT NULL,
    status          SMALLINT           NOT NULL DEFAULT 1,
    create_date     INT                NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (processor_id) REFERENCES job_processor (processor_id),
    FOREIGN KEY (job_group_id) REFERENCES job_group (job_group_id),
    FOREIGN KEY (job_type_id) REFERENCES job_type (job_type_id)
);


-- -----------------------
-- job - object table
CREATE TABLE job_object
(
    job_object_id CHAR(44) NOT NULL PRIMARY KEY,
    job_id        CHAR(44) NOT NULL,
    object_id     CHAR(44) NOT NULL,
    locked        SMALLINT NOT NULL DEFAULT 0,
    status        SMALLINT NOT NULL DEFAULT 1,
    create_date   INT      NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (job_id) REFERENCES job (job_id),
    FOREIGN KEY (object_id) REFERENCES object (object_id),
    UNIQUE (object_id, job_id)
);

