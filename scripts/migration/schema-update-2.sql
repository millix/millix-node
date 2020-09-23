UPDATE schema_information SET value = "2" WHERE key = "version";

CREATE TABLE api
(
    api_id             CHAR(16)  NOT NULL UNIQUE CHECK (length(api_id) <= 16),
    name               CHAR(255) NOT NULL CHECK (length(name) <= 255),
    description        CHAR(255) NOT NULL CHECK (length(description) <= 255),
    method             CHAR(10)  NOT NULL CHECK (length(method) <= 10),
    version_released   CHAR(10)  NOT NULL CHECK (length(version_released) <= 10),
    version_deprecated CHAR(10)  NULL CHECK (length(version_deprecated) <= 10),
    version_removed    CHAR(10)  NULL CHECK (length(version_removed) <= 10),
    permission         TEXT      NOT NULL DEFAULT "true",
    status             TINYINT   NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date        INT       NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK (length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_api_create_date ON api (create_date);
