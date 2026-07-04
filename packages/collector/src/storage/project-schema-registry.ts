import {
  PROJECT_EVENT_COLUMN_TYPES,
  sanitizeIdentifier,
  type ColumnInfo,
  type InferredAttributeType,
  type ProjectEventRow,
} from "@wide-events/internal";
import type { CollectorDatabase } from "./types.js";

const PROJECT_EVENT_BASE_COLUMN_NAMES = new Set<string>(
  Object.keys(PROJECT_EVENT_COLUMN_TYPES),
);
const PROJECT_EVENT_MAP_COLUMNS = new Set<string>([
  "project_fields",
  "project_field_types",
]);

export class ProjectSchemaRegistry {
  private readonly columns = new Map<string, string>();

  constructor() {
    for (const [name, type] of Object.entries(PROJECT_EVENT_COLUMN_TYPES)) {
      this.columns.set(name, type);
    }
  }

  async hydrate(database: CollectorDatabase): Promise<void> {
    for (const row of await database.readColumns("project_events")) {
      this.columns.set(
        expectString(row.name, "project table column name"),
        expectString(row.type, "project table column type"),
      );
    }
  }

  listColumns(): ColumnInfo[] {
    return [...this.columns.entries()]
      .map<ColumnInfo>(([name, type]) => ({
        name,
        storageState: PROJECT_EVENT_BASE_COLUMN_NAMES.has(name)
          ? "baseline"
          : "project",
        queryable: !PROJECT_EVENT_MAP_COLUMNS.has(name),
        inferredType: type,
        promotedType: null,
        seenRows: 0,
        lastSeenAt: null,
        source: "project_events",
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  isQueryableColumn(name: string): boolean {
    return this.columns.has(name) && !PROJECT_EVENT_MAP_COLUMNS.has(name);
  }

  async ensureProjectColumns(
    database: CollectorDatabase,
    rows: readonly ProjectEventRow[],
  ): Promise<void> {
    const requiredColumns = collectProjectColumns(rows);
    for (const [column, type] of requiredColumns.entries()) {
      const existing = this.columns.get(column);
      if (existing) {
        if (!isCompatibleColumnType(existing, type)) {
          throw new Error(
            `Project field "${column}" already exists with incompatible type ${existing}`,
          );
        }
        continue;
      }

      await database.addPromotedColumn("project_events", column, type);
      this.columns.set(column, type);
    }
  }
}

function collectProjectColumns(
  rows: readonly ProjectEventRow[],
): Map<string, InferredAttributeType> {
  const columns = new Map<string, InferredAttributeType>();
  for (const row of rows) {
    for (const [field, type] of Object.entries(row.project_field_types)) {
      const column = sanitizeIdentifier(field);
      const existing = columns.get(column);
      if (existing && existing !== type) {
        throw new Error(
          `Project field "${field}" has conflicting types ${existing} and ${type}`,
        );
      }
      columns.set(column, type);
    }
  }
  return columns;
}

function isCompatibleColumnType(
  existingType: string,
  expectedType: InferredAttributeType,
): boolean {
  if (existingType === expectedType) {
    return true;
  }

  const normalized = existingType.toUpperCase();
  switch (expectedType) {
    case "BOOLEAN":
      return normalized.includes("BOOL");
    case "BIGINT":
      return normalized.includes("BIGINT") || normalized.includes("INT64");
    case "DOUBLE":
      return normalized.includes("DOUBLE") || normalized.includes("FLOAT64");
    case "VARCHAR":
      return normalized.includes("VARCHAR") || normalized.includes("STRING");
    case "JSON":
      return (
        normalized.includes("JSON") ||
        normalized.includes("VARCHAR") ||
        normalized.includes("STRING")
      );
    default:
      return assertNever(expectedType);
  }
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }

  return value;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported project column type: ${String(value)}`);
}
