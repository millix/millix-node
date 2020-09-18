CREATE TABLE schema_information
(
    key         TEXT         NOT NULL UNIQUE,
    value       TEXT         NOT NULL,
    status      TINYINT      NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date INT          NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_schema_information_create_date ON schema_information (create_date);

CREATE TABLE address_version
(
    version         CHAR(4)      NOT NULL UNIQUE CHECK (length(version) <= 4),
    is_main_network TINYINT      NOT NULL DEFAULT 1 CHECK (length(is_main_network) <= 3 AND TYPEOF(is_main_network) = 'integer'),
    regex_pattern   TEXT         NOT NULL,
    is_default      TINYINT      NOT NULL DEFAULT 0 CHECK (length(is_default) <= 3 AND TYPEOF(is_default) = 'integer'),
    status          TINYINT      NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date     INT          NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE INDEX idx_address_version_create_date ON address_version (create_date);

INSERT INTO schema_information (key, value)
VALUES ("version", "1");

INSERT INTO address_version(version, is_main_network, is_default, regex_pattern)
VALUES ("0a0", 1, 1, "(?<address>.*)(?<version>0a0)(?<identifier>.*)"),
       ("0b0", 1, 0, "(?<address>.*)(?<version>0b0)(?<identifier>.*)"),
       ("lal", 0, 1, "(?<address>.*)(?<version>lal)(?<identifier>.*)"),
       ("la0l", 0, 1, "(?<address>.*)(?<version>la0l)(?<identifier>.*)"),
       ("lb0l", 0, 0, "(?<address>.*)(?<version>lb0l)(?<identifier>.*)");
