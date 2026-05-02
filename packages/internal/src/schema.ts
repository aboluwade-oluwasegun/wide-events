export const BASELINE_COLUMN_TYPES = {
  event_id: "VARCHAR",
  correlation_id: "VARCHAR",
  parent_event_id: "VARCHAR",
  ts: "TIMESTAMPTZ",
  duration_ms: "DOUBLE",
  main: "BOOLEAN",
  sample_rate: "INTEGER",
  "service.name": "VARCHAR",
  "service.environment": "VARCHAR",
  "service.version": "VARCHAR",
  "http.route": "VARCHAR",
  "http.status_code": "INTEGER",
  "http.request.method": "VARCHAR",
  error: "BOOLEAN",
  "exception.slug": "VARCHAR",
  "user.id": "VARCHAR",
  "user.type": "VARCHAR",
  "user.org.id": "VARCHAR",
  attributes_overflow: "MAP(VARCHAR, JSON)"
} as const;

export type BaselineColumnName = keyof typeof BASELINE_COLUMN_TYPES;

export const BASELINE_COLUMN_NAMES = Object.freeze(
  Object.keys(BASELINE_COLUMN_TYPES)
);

export const BASE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS events (
  event_id VARCHAR NOT NULL,
  correlation_id VARCHAR NOT NULL,
  parent_event_id VARCHAR,
  ts TIMESTAMPTZ NOT NULL,
  duration_ms DOUBLE,
  main BOOLEAN NOT NULL DEFAULT false,
  sample_rate INTEGER NOT NULL DEFAULT 1,
  "service.name" VARCHAR,
  "service.environment" VARCHAR,
  "service.version" VARCHAR,
  "http.route" VARCHAR,
  "http.status_code" INTEGER,
  "http.request.method" VARCHAR,
  error BOOLEAN,
  "exception.slug" VARCHAR,
  "user.id" VARCHAR,
  "user.type" VARCHAR,
  "user.org.id" VARCHAR,
  attributes_overflow MAP(VARCHAR, JSON) NOT NULL DEFAULT MAP()
)`;

export const ATTRIBUTE_CATALOG_SQL = `CREATE TABLE IF NOT EXISTS attribute_catalog (
  key VARCHAR NOT NULL PRIMARY KEY,
  sanitized_key VARCHAR NOT NULL,
  storage_state VARCHAR NOT NULL,
  inferred_type VARCHAR NOT NULL,
  seen_rows BIGINT NOT NULL DEFAULT 0,
  non_null_rows BIGINT NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  promoted_column VARCHAR,
  promoted_type VARCHAR,
  promoted_at TIMESTAMPTZ,
  last_error VARCHAR
)`;
