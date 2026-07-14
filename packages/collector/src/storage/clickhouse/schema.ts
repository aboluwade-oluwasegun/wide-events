import {
  BASELINE_COLUMN_TYPES,
  PROJECT_EVENT_COLUMN_TYPES,
  sanitizeIdentifier,
  type InferredAttributeType,
} from "@wide-events/internal";
import type { ClickHouseCommandClient } from "./client.js";

export interface ClickHouseSchemaStatement {
  label: string;
  query: string;
}

type ClickHouseStorageType =
  | InferredAttributeType
  | "TIMESTAMPTZ"
  | "INTEGER"
  | "MAP(VARCHAR, JSON)"
  | "MAP(VARCHAR, VARCHAR)";

export function buildClickHouseSchemaStatements(
  database: string,
): ClickHouseSchemaStatement[] {
  const eventsTable = clickHouseQualifiedIdentifier(database, "events");
  const attributeCatalogTable = clickHouseQualifiedIdentifier(
    database,
    "attribute_catalog",
  );
  const projectEventsTable = clickHouseQualifiedIdentifier(database, "project_events");

  return [
    {
      label: "database",
      query: `CREATE DATABASE IF NOT EXISTS ${clickHouseQuoteIdentifier(database)}`,
    },
    {
      label: "events table",
      query: `CREATE TABLE IF NOT EXISTS ${eventsTable} (
  ${buildClickHouseEventsColumns().join(",\n  ")}
)
ENGINE = MergeTree
ORDER BY (${[
        "ts",
        "service.name",
        "correlation_id",
        "event_id",
      ]
        .map(clickHouseQuoteIdentifier)
        .join(", ")})`,
    },
    {
      label: "project events table",
      query: `CREATE TABLE IF NOT EXISTS ${projectEventsTable} (
  ${buildClickHouseProjectEventsColumns().join(",\n  ")}
)
ENGINE = MergeTree
ORDER BY (${[
        "ts",
        "project_id",
        "service.name",
        "correlation_id",
        "event_id",
      ]
        .map(clickHouseQuoteIdentifier)
        .join(", ")})`,
    },
    {
      label: "attribute catalog table",
      query: `CREATE TABLE IF NOT EXISTS ${attributeCatalogTable} (
  ${[
        "`key` String",
        "`sanitized_key` String",
        "`storage_state` LowCardinality(String)",
        "`inferred_type` LowCardinality(String)",
        "`seen_rows` Int64 DEFAULT 0",
        "`non_null_rows` Int64 DEFAULT 0",
        "`first_seen_at` DateTime64(3, 'UTC')",
        "`last_seen_at` DateTime64(3, 'UTC')",
        "`promoted_column` Nullable(String)",
        "`promoted_type` Nullable(LowCardinality(String))",
        "`promoted_at` Nullable(DateTime64(3, 'UTC'))",
        "`last_error` Nullable(String)",
        "`updated_at` DateTime64(3, 'UTC') DEFAULT now64(3)",
      ].join(",\n  ")}
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (${clickHouseQuoteIdentifier("key")})`,
    },
  ];
}

export async function initializeClickHouseSchema(
  client: ClickHouseCommandClient,
  database: string,
): Promise<void> {
  for (const statement of buildClickHouseSchemaStatements(database)) {
    await client.command({ query: statement.query });
  }
}

export function toClickHouseColumnType(
  storageType: ClickHouseStorageType,
  nullable: boolean,
): string {
  const type = toClickHouseNonNullableColumnType(storageType);
  return nullable ? `Nullable(${type})` : type;
}

export function clickHouseQualifiedIdentifier(
  database: string,
  table: string,
): string {
  return `${clickHouseQuoteIdentifier(database)}.${clickHouseQuoteIdentifier(table)}`;
}

export function clickHouseQuoteIdentifier(identifier: string): string {
  return `\`${sanitizeIdentifier(identifier)}\``;
}

export function clickHouseQuoteStringLiteral(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

function buildClickHouseEventsColumns(): string[] {
  return Object.entries(BASELINE_COLUMN_TYPES).map(([column, storageType]) => {
    if (column === "attributes_overflow") {
      return `${clickHouseQuoteIdentifier(column)} Map(String, String) DEFAULT map()`;
    }

    if (column === "main") {
      return `${clickHouseQuoteIdentifier(column)} Bool DEFAULT false`;
    }

    if (column === "sample_rate") {
      return `${clickHouseQuoteIdentifier(column)} Int32 DEFAULT 1`;
    }

    return `${clickHouseQuoteIdentifier(column)} ${toClickHouseColumnType(
      storageType,
      isNullableBaselineColumn(column),
    )}`;
  });
}

function buildClickHouseProjectEventsColumns(): string[] {
  return Object.entries(PROJECT_EVENT_COLUMN_TYPES).map(([column, storageType]) => {
    if (column === "project_fields" || column === "project_field_types") {
      return `${clickHouseQuoteIdentifier(column)} Map(String, String) DEFAULT map()`;
    }

    if (column === "main") {
      return `${clickHouseQuoteIdentifier(column)} Bool DEFAULT false`;
    }

    if (column === "sample_rate") {
      return `${clickHouseQuoteIdentifier(column)} Int32 DEFAULT 1`;
    }

    return `${clickHouseQuoteIdentifier(column)} ${toClickHouseColumnType(
      storageType,
      isNullableProjectEventColumn(column),
    )}`;
  });
}

function toClickHouseNonNullableColumnType(
  storageType: ClickHouseStorageType,
): string {
  switch (storageType) {
    case "VARCHAR":
      return "String";
    case "TIMESTAMPTZ":
      return "DateTime64(3, 'UTC')";
    case "DOUBLE":
      return "Float64";
    case "BOOLEAN":
      return "Bool";
    case "INTEGER":
      return "Int32";
    case "BIGINT":
      return "Int64";
    case "MAP(VARCHAR, JSON)":
    case "MAP(VARCHAR, VARCHAR)":
      return "Map(String, String)";
    case "JSON":
      return "String";
    default:
      return assertNever(storageType);
  }
}

function isNullableProjectEventColumn(column: string): boolean {
  return ![
    "event_id",
    "correlation_id",
    "ts",
    "main",
    "sample_rate",
    "project_id",
    "project_fields",
    "project_field_types",
  ].includes(column);
}

function isNullableBaselineColumn(column: string): boolean {
  return ![
    "event_id",
    "correlation_id",
    "ts",
    "main",
    "sample_rate",
    "attributes_overflow",
  ].includes(column);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported ClickHouse column type: ${String(value)}`);
}
