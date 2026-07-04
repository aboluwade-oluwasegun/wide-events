export const EVENT_ROW_BASE_COLUMN_TYPES = {
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
  "user.org.id": "VARCHAR"
} as const;

export const BASELINE_COLUMN_TYPES = {
  ...EVENT_ROW_BASE_COLUMN_TYPES,
  attributes_overflow: "MAP(VARCHAR, JSON)"
} as const;

export type EventRowBaseColumnName = keyof typeof EVENT_ROW_BASE_COLUMN_TYPES;

export type BaselineColumnName = keyof typeof BASELINE_COLUMN_TYPES;

export const EVENT_ROW_BASE_COLUMN_NAMES = Object.freeze(
  Object.keys(EVENT_ROW_BASE_COLUMN_TYPES) as EventRowBaseColumnName[]
);

export const BASELINE_COLUMN_NAMES = Object.freeze(
  Object.keys(BASELINE_COLUMN_TYPES) as BaselineColumnName[]
);

export const PROJECT_EVENT_METADATA_KEYS = [
  "project_id",
  "project_rule_version",
  "project_fields",
  "project_field_types"
] as const;

export type ProjectEventMetadataKey = (typeof PROJECT_EVENT_METADATA_KEYS)[number];

export const PROJECT_EVENT_RESERVED_FIELD_NAMES = Object.freeze([
  ...BASELINE_COLUMN_NAMES,
  ...PROJECT_EVENT_METADATA_KEYS
] as Array<BaselineColumnName | ProjectEventMetadataKey>);

export const PROJECT_EVENT_COLUMN_TYPES = {
  ...EVENT_ROW_BASE_COLUMN_TYPES,
  project_id: "VARCHAR",
  project_rule_version: "VARCHAR",
  project_fields: "MAP(VARCHAR, JSON)",
  project_field_types: "MAP(VARCHAR, VARCHAR)"
} as const;

export type ProjectEventColumnName = keyof typeof PROJECT_EVENT_COLUMN_TYPES;

export const PROJECT_EVENT_COLUMN_NAMES = Object.freeze(
  Object.keys(PROJECT_EVENT_COLUMN_TYPES) as ProjectEventColumnName[]
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

export const PROJECT_EVENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS project_events (
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
  project_id VARCHAR NOT NULL,
  project_rule_version VARCHAR,
  project_fields MAP(VARCHAR, JSON) NOT NULL DEFAULT MAP(),
  project_field_types MAP(VARCHAR, VARCHAR) NOT NULL DEFAULT MAP()
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
