import type {
  AttributeCatalogEntry,
  InferredAttributeType,
  PromotionStorageState,
  QueryRow,
} from "@wide-events/internal";

export const ATTRIBUTE_CATALOG_COLUMNS = [
  "key",
  "sanitized_key",
  "storage_state",
  "inferred_type",
  "seen_rows",
  "non_null_rows",
  "first_seen_at",
  "last_seen_at",
  "promoted_column",
  "promoted_type",
  "promoted_at",
  "last_error",
] as const;

export type AttributeCatalogColumn = (typeof ATTRIBUTE_CATALOG_COLUMNS)[number];

export function attributeCatalogEntryToRow(
  entry: AttributeCatalogEntry,
): Record<AttributeCatalogColumn, unknown> {
  return {
    key: entry.key,
    sanitized_key: entry.sanitizedKey,
    storage_state: entry.storageState,
    inferred_type: entry.inferredType,
    seen_rows: entry.seenRows,
    non_null_rows: entry.nonNullRows,
    first_seen_at: entry.firstSeenAt,
    last_seen_at: entry.lastSeenAt,
    promoted_column: entry.promotedColumn,
    promoted_type: entry.promotedType,
    promoted_at: entry.promotedAt,
    last_error: entry.lastError,
  };
}

export function attributeCatalogEntryFromRow(row: QueryRow): AttributeCatalogEntry {
  const key = expectString(row["key"], "attribute_catalog.key");
  return {
    key,
    sanitizedKey: expectString(
      row["sanitized_key"],
      "attribute_catalog.sanitized_key",
    ),
    storageState: expectStorageState(row["storage_state"]),
    inferredType: expectInferredType(row["inferred_type"]),
    seenRows: expectNumber(row["seen_rows"], "attribute_catalog.seen_rows"),
    nonNullRows: expectNumber(
      row["non_null_rows"],
      "attribute_catalog.non_null_rows",
    ),
    firstSeenAt: expectString(
      row["first_seen_at"],
      "attribute_catalog.first_seen_at",
    ),
    lastSeenAt: expectString(row["last_seen_at"], "attribute_catalog.last_seen_at"),
    promotedColumn: expectNullableString(row["promoted_column"]),
    promotedType: expectNullableInferredType(row["promoted_type"]),
    promotedAt: expectNullableString(row["promoted_at"]),
    lastError: expectNullableString(row["last_error"]),
  };
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

function expectNullableInferredType(
  value: unknown,
): InferredAttributeType | null {
  return value === null || typeof value === "undefined"
    ? null
    : expectInferredType(value);
}
