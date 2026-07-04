import type { DuckDBValue } from "@duckdb/node-api";
import type { EventValue, QueryRow } from "@wide-events/internal";

export function normalizeDuckDbRows(rows: Record<string, unknown>[]): QueryRow[] {
  return rows.map((row) => {
    const normalized: QueryRow = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = normalizeDuckDbResultValue(value);
    }
    return normalized;
  });
}

export function toDuckDbValues(values: readonly unknown[]): DuckDBValue[] {
  return values.map((value) => {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    ) {
      return value;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === "undefined") {
      return null;
    }

    throw new Error(`Unsupported DuckDB parameter type: ${typeof value}`);
  });
}

export function serializeDuckDbInsertValue(
  column: string,
  value: unknown,
): unknown {
  if (
    column === "attributes_overflow" ||
    column === "project_fields" ||
    column === "project_field_types"
  ) {
    return JSON.stringify(value ?? {});
  }

  return value;
}

function normalizeDuckDbResultValue(value: unknown): EventValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    const numericValue = Number(value);
    return Number.isSafeInteger(numericValue) ? numericValue : value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    if (isDuckDbMapEntryArray(value)) {
      const record: Record<string, EventValue> = {};
      for (const entry of value) {
        record[entry.key] = normalizeJsonLiteral(entry.value);
      }
      return record;
    }

    return value.map((entry) => normalizeDuckDbResultValue(entry));
  }

  if (typeof value === "object") {
    const record: Record<string, EventValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      record[key] = normalizeDuckDbResultValue(entry);
    }
    return record;
  }

  return JSON.stringify(value);
}

function isDuckDbMapEntryArray(
  value: readonly unknown[],
): value is Array<{ key: string; value: unknown }> {
  return value.every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      "key" in entry &&
      typeof entry["key"] === "string" &&
      "value" in entry,
  );
}

function normalizeJsonLiteral(value: unknown): EventValue {
  if (typeof value !== "string") {
    return normalizeDuckDbResultValue(value);
  }

  try {
    return normalizeDuckDbResultValue(JSON.parse(value));
  } catch {
    return value;
  }
}
