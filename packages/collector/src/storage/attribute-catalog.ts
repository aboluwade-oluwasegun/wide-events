import {
  isBaselineColumn,
  sanitizeIdentifier,
  type AttributeCatalogEntry,
  type ColumnInfo,
  type DynamicEventAttributes,
  type EventValue,
  type StoredEventRow,
  type InferredAttributeType,
  type PromotionStorageState,
} from "@wide-events/internal";
import type { SchemaRegistry } from "./schema-registry.js";
import type { CollectorDatabase } from "./types.js";

interface PromotionCandidate extends AttributeCatalogEntry {
  nonNullRatio: number;
}

export class AttributeCatalog {
  private readonly entries = new Map<string, AttributeCatalogEntry>();

  async hydrate(database: CollectorDatabase): Promise<void> {
    for (const entry of await database.loadAttributeCatalog()) {
      this.entries.set(entry.key, entry);
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
    if (isBaselineColumn(field)) {
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
          isBaselineColumn(column.name) &&
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
    database: CollectorDatabase,
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
    database: CollectorDatabase,
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
    database: CollectorDatabase,
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

  async markFailed(database: CollectorDatabase, key: string, error: unknown): Promise<void> {
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
  database: CollectorDatabase,
  entry: AttributeCatalogEntry
): Promise<void> {
  await database.saveAttributeCatalogEntry(entry);
}

function sortByName(left: ColumnInfo, right: ColumnInfo): number {
  return left.name.localeCompare(right.name);
}
