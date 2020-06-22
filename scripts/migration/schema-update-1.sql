CREATE TABLE schema_information
(
    key         VARCHAR(255) NOT NULL UNIQUE,
    value       VARCHAR(255) NOT NULL,
    status      SMALLINT     NOT NULL DEFAULT 1,
    create_date INT          NOT NULL DEFAULT (strftime('%s', 'now'))
);

INSERT INTO schema_information (key, value) VALUES ("version", "1");

CREATE TABLE address_version
(
    version         CHAR(3)      NOT NULL UNIQUE,
    is_main_network SMALLINT     NOT NULL DEFAULT 1,
    regex_pattern   VARCHAR(255) NOT NULL,
    is_default      SMALLINT     NOT NULL DEFAULT 0,
    status          SMALLINT     NOT NULL DEFAULT 1,
    create_date     INT          NOT NULL DEFAULT (strftime('%s', 'now'))
);

INSERT INTO address_version(version, is_main_network, is_default, regex_pattern)
VALUES ("0a0", 1, 1, "(?<address>.*)(?<version>0a0)(?<identifier>.*)"),
       ("lal", 0, 1, "(?<address>.*)(?<version>lal)(?<identifier>.*)");
