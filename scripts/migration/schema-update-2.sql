UPDATE schema_information SET value = "2" WHERE key = "version";

CREATE TABLE api
(
    api_id             VARCHAR(16)  NOT NULL UNIQUE,
    name               VARCHAR(255) NOT NULL,
    description        VARCHAR(255) NOT NULL,
    method             VARCHAR(10)  NOT NULL,
    version_released   VARCHAR(10)  NOT NULL,
    version_deprecated VARCHAR(10)  NULL,
    version_removed    VARCHAR(10)  NULL,
    permission         TEXT         NOT NULL DEFAULT "true",
    status             SMALLINT     NOT NULL DEFAULT 1,
    create_date        INT          NOT NULL DEFAULT (strftime('%s', 'now'))
);
