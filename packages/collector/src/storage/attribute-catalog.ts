import {
  BASELINE_COLUMN_NAMES,
  sanitizeIdentifier,
  type AttributeCatalogEntry,
  type ColumnInfo,
  type DynamicEventAttributes,
  type EventValue,
  type StoredEventRow,
  type InferredAttributeType,
  type PromotionStorageState
} from "@wide-events/internal";
import type { DuckDbDatabase } from "./database.js";
import type { SchemaRegistry } from "./schema-registry.js";

interface PromotionCandidate extends AttributeCatalogEntry {
  nonNullRatio: number;
}

export class AttributeCatalog {
  private readonly entries = new Map<string, AttributeCatalogEntry>();

  async hydrate(database: DuckDbDatabase): Promise<void> {
    const rows = await database.executeRead(`
      SELECT
        key,
        sanitized_key,
        storage_state,
        inferred_type,
        seen_rows,
        non_null_rows,
        first_seen_at,
        last_seen_at,
        promoted_column,
        promoted_type,
        promoted_at,
        last_error
      FROM attribute_catalog
    `);

    for (const row of rows) {
      const key = expectString(row["key"], "attribute_catalog.key");
      this.entries.set(key, {
        key,
        sanitizedKey: expectString(
          row["sanitized_key"],
          "attribute_catalog.sanitized_key"
        ),
        storageState: expectStorageState(row["storage_state"]),
        inferredType: expectInferredType(row["inferred_type"]),
        seenRows: expectNumber(row["seen_rows"], "attribute_catalog.seen_rows"),
        nonNullRows: expectNumber(
          row["non_null_rows"],
          "attribute_catalog.non_null_rows"
        ),
        firstSeenAt: expectString(
          row["first_seen_at"],
          "attribute_catalog.first_seen_at"
        ),
        lastSeenAt: expectString(
          row["last_seen_at"],
          "attribute_catalog.last_seen_at"
        ),
        promotedColumn: expectNullableString(row["promoted_column"]),
        promotedType: expectNullableInferredType(row["promoted_type"]),
        promotedAt: expectNullableString(row["promoted_at"]),
        lastError: expectNullableString(row["last_error"])
      });
    }
  }

  getPromotedColumns(): Map<string, { column: string; type: InferredAttributeType }> {
    const promoted = new Map<string, { column: string; type: InferredAttributeType }>();

    for (const entry of this.entries.values()) {
      if (
        entry.storageState === "promoted" &&
        entry.promotedColumn &&
        entry.promotedType
      ) {
        promoted.set(entry.key, {
          column: entry.promotedColumn,
          type: entry.promotedType
        });
      }
    }

    return promoted;
  }

  getEntry(key: string): AttributeCatalogEntry | null {
    return this.entries.get(key) ?? null;
  }

  getFieldStorageState(field: string): PromotionStorageState | "baseline" | "unknown" {
    if (BASELINE_COLUMN_NAMES.includes(field)) {
      return "baseline";
    }

    const entry = this.entries.get(field);
    return entry ? entry.storageState : "unknown";
  }

  listColumns(schema: SchemaRegistry): ColumnInfo[] {
    const baselineColumns = schema
      .listActualColumns()
      .filter(
        (column) =>
          BASELINE_COLUMN_NAMES.includes(column.name) &&
          column.name !== "attributes_overflow"
      )
      .map<ColumnInfo>((column) => ({
        name: column.name,
        storageState: "baseline",
        queryable: true,
        inferredType: column.type,
        promotedType: null,
        seenRows: 0,
        lastSeenAt: null
      }));

    const dynamicColumns = [...this.entries.values()]
      .map<ColumnInfo>((entry) => ({
        name: entry.key,
        storageState:
          entry.storageState === "promoting" ? "overflow_only" : entry.storageState,
        queryable: entry.storageState === "promoted",
        inferredType: entry.inferredType,
        promotedType: entry.promotedType,
        seenRows: entry.seenRows,
        lastSeenAt: entry.lastSeenAt
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return [...baselineColumns.sort(sortByName), ...dynamicColumns];
  }

  async recordRows(
    database: DuckDbDatabase,
    rows: readonly StoredEventRow[]
  ): Promise<void> {
    const now = new Date().toISOString();
    const updates = new Map<string, AttributeCatalogEntry>();

    for (const row of rows) {
      applyRowAttributes(updates, row.attributes_overflow, now, this.entries);
    }

    for (const entry of updates.values()) {
      this.entries.set(entry.key, entry);
      await persistEntry(database, entry);
    }
  }

  selectPromotionCandidates(
    totalRetainedRows: number,
    minRows: number,
    minRatio: number,
    limit: number
  ): PromotionCandidate[] {
    if (totalRetainedRows <= 0) {
      return [];
    }

    return [...this.entries.values()]
      .filter(
        (entry) =>
          entry.storageState === "overflow_only" &&
          entry.nonNullRows >= minRows &&
          entry.inferredType !== "JSON"
      )
      .map((entry) => ({
        ...entry,
        nonNullRatio: entry.nonNullRows / totalRetainedRows
      }))
      .filter((entry) => entry.nonNullRatio >= minRatio)
      .sort(
        (left, right) =>
          right.nonNullRows - left.nonNullRows ||
          right.lastSeenAt.localeCompare(left.lastSeenAt)
      )
      .slice(0, limit);
  }

  async markPromoting(
    database: DuckDbDatabase,
    key: string
  ): Promise<AttributeCatalogEntry | null> {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }

    const updated: AttributeCatalogEntry = {
      ...entry,
      storageState: "promoting",
      lastError: null
    };
    this.entries.set(key, updated);
    await persistEntry(database, updated);
    return updated;
  }

  async markPromoted(
    database: DuckDbDatabase,
    key: string,
    promotedColumn: string,
    promotedType: InferredAttributeType
  ): Promise<void> {
    const now = new Date().toISOString();
    const entry =
      this.entries.get(key) ?? {
        key,
        sanitizedKey: promotedColumn,
        storageState: "overflow_only",
        inferredType: promotedType,
        seenRows: 0,
        nonNullRows: 0,
        firstSeenAt: now,
        lastSeenAt: now,
        promotedColumn: null,
        promotedType: null,
        promotedAt: null,
        lastError: null
      };

    const updated: AttributeCatalogEntry = {
      ...entry,
      storageState: "promoted",
      promotedColumn,
      promotedType,
      promotedAt: new Date().toISOString(),
      lastError: null
    };
    this.entries.set(key, updated);
    await persistEntry(database, updated);
  }

  async markFailed(database: DuckDbDatabase, key: string, error: unknown): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }

    const updated: AttributeCatalogEntry = {
      ...entry,
      storageState: "failed",
      lastError: error instanceof Error ? error.message : String(error)
    };
    this.entries.set(key, updated);
    await persistEntry(database, updated);
  }
}

function applyRowAttributes(
  updates: Map<string, AttributeCatalogEntry>,
  attributes: DynamicEventAttributes,
  now: string,
  existingEntries: ReadonlyMap<string, AttributeCatalogEntry>
): void {
  for (const [key, value] of Object.entries(attributes)) {
    const sanitizedKey = sanitizeIdentifier(key);
    const previous =
      updates.get(key) ??
      existingEntries.get(key) ?? {
        key,
        sanitizedKey,
        storageState: "overflow_only",
        inferredType: nonNullValueType(value),
        seenRows: 0,
        nonNullRows: 0,
        firstSeenAt: now,
        lastSeenAt: now,
        promotedColumn: null,
        promotedType: null,
        promotedAt: null,
        lastError: null
      };

    const nonNull = value !== null;
    const inferredType = nonNull
      ? mergeInferredType(previous.inferredType, inferValueType(value))
      : previous.inferredType;

    updates.set(key, {
      ...previous,
      seenRows: previous.seenRows + 1,
      nonNullRows: previous.nonNullRows + (nonNull ? 1 : 0),
      inferredType,
      lastSeenAt: now
    });
  }
}

function nonNullValueType(value: EventValue): InferredAttributeType {
  return inferValueType(value);
}

export function inferValueType(value: EventValue): InferredAttributeType {
  if (value === null) {
    return "JSON";
  }

  if (typeof value === "boolean") {
    return "BOOLEAN";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? "BIGINT" : "DOUBLE";
  }

  if (typeof value === "string") {
    return "VARCHAR";
  }

  return "JSON";
}

export function mergeInferredType(
  current: InferredAttributeType,
  next: InferredAttributeType
): InferredAttributeType {
  if (current === next) {
    return current;
  }

  if (current === "JSON" || next === "JSON") {
    return "JSON";
  }

  if (
    (current === "BIGINT" && next === "DOUBLE") ||
    (current === "DOUBLE" && next === "BIGINT")
  ) {
    return "DOUBLE";
  }

  return "JSON";
}

async function persistEntry(
  database: DuckDbDatabase,
  entry: AttributeCatalogEntry
): Promise<void> {
  await database.execute(
    `INSERT INTO attribute_catalog (
      key,
      sanitized_key,
      storage_state,
      inferred_type,
      seen_rows,
      non_null_rows,
      first_seen_at,
      last_seen_at,
      promoted_column,
      promoted_type,
      promoted_at,
      last_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      sanitized_key = excluded.sanitized_key,
      storage_state = excluded.storage_state,
      inferred_type = excluded.inferred_type,
      seen_rows = excluded.seen_rows,
      non_null_rows = excluded.non_null_rows,
      first_seen_at = excluded.first_seen_at,
      last_seen_at = excluded.last_seen_at,
      promoted_column = excluded.promoted_column,
      promoted_type = excluded.promoted_type,
      promoted_at = excluded.promoted_at,
      last_error = excluded.last_error`,
    [
      entry.key,
      entry.sanitizedKey,
      entry.storageState,
      entry.inferredType,
      entry.seenRows,
      entry.nonNullRows,
      entry.firstSeenAt,
      entry.lastSeenAt,
      entry.promotedColumn,
      entry.promotedType,
      entry.promotedAt,
      entry.lastError
    ]
  );
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }

  return value;
}

function expectNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function expectNumber(value: unknown, label: string): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error(`${label} must be a number`);
}

function expectStorageState(value: unknown): PromotionStorageState {
  if (
    value === "overflow_only" ||
    value === "promoting" ||
    value === "promoted" ||
    value === "failed"
  ) {
    return value;
  }

  throw new Error(`Unsupported storage state: ${String(value)}`);
}

function expectInferredType(value: unknown): InferredAttributeType {
  if (
    value === "BOOLEAN" ||
    value === "BIGINT" ||
    value === "DOUBLE" ||
    value === "VARCHAR" ||
    value === "JSON"
  ) {
    return value;
  }

  throw new Error(`Unsupported inferred type: ${String(value)}`);
}

function expectNullableInferredType(value: unknown): InferredAttributeType | null {
  return value === null || typeof value === "undefined"
    ? null
    : expectInferredType(value);
}

function sortByName(left: ColumnInfo, right: ColumnInfo): number {
  return left.name.localeCompare(right.name);
}
