import type { EventValue, QueryRow } from "@wide-events/internal";

export function serializeClickHouseInsertValue(
  column: string,
  value: unknown,
): unknown {
  if (column === "attributes_overflow") {
    return serializeClickHouseOverflowMap(value);
  }

  return value ?? null;
}

export function normalizeClickHouseRows(rows: Record<string, unknown>[]): QueryRow[] {
  return rows.map((row) => {
    const normalized: QueryRow = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = normalizeClickHouseValue(value);
    }
    return normalized;
  });
}

export function expectClickHouseRows(rows: unknown[]): Record<string, unknown>[] {
  return rows.map((row) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("ClickHouse query returned a non-object row");
    }
    return row as Record<string, unknown>;
  });
}

export function toNonEmptyArray<T>(values: readonly T[]): [T, ...T[]] {
  const [first, ...rest] = values;
  if (typeof first === "undefined") {
    throw new Error("ClickHouse insert requires at least one column");
  }
  return [first, ...rest];
}

function serializeClickHouseOverflowMap(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] =
      entry === null || typeof entry === "undefined"
        ? "null"
        : typeof entry === "string"
          ? entry
          : JSON.stringify(entry);
  }
  return out;
}

function normalizeClickHouseValue(value: unknown): EventValue {
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

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeClickHouseValue(entry));
  }

  if (typeof value === "object") {
    const record: Record<string, EventValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      record[key] = normalizeClickHouseValue(entry);
    }
    return record;
  }

  return JSON.stringify(value);
}
