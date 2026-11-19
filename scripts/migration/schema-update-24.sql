PRAGMA foreign_keys= off;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS cloud_offer
(
    offer_id     CHAR(50)    NOT NULL PRIMARY KEY CHECK (length(offer_id) <= 50),
    node_id      CHAR(34)    NOT NULL CHECK (length(node_id) <= 34),
    service      CHAR(32)    NOT NULL CHECK (length(service) <= 32),
    country      CHAR(2)     NOT NULL CHECK (length(country) = 2),
    city         TEXT        NULL,
    publish_date INT         NOT NULL CHECK (length(publish_date) <= 10 AND TYPEOF(publish_date) = 'integer'),
    end_date     INT         NOT NULL CHECK (length(end_date) <= 10 AND TYPEOF(end_date) = 'integer'),
    offer        TEXT        NOT NULL,
    status       TINYINT     NOT NULL DEFAULT 1 CHECK (length(status) <= 3 AND TYPEOF(status) = 'integer'),
    create_date  INT         NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) CHECK(length(create_date) <= 10 AND TYPEOF(create_date) = 'integer')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_offer_node_id_service ON cloud_offer (node_id, service);
CREATE INDEX IF NOT EXISTS idx_cloud_offer_service_country ON cloud_offer (service, country);
CREATE INDEX IF NOT EXISTS idx_cloud_offer_end_date ON cloud_offer (end_date);
CREATE INDEX IF NOT EXISTS idx_cloud_offer_create_date ON cloud_offer (create_date);

UPDATE schema_information SET value = "24" WHERE key = "version";

COMMIT;
