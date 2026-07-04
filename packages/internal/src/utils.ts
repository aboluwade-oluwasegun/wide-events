import { BASELINE_COLUMN_NAMES, type BaselineColumnName } from "./schema";
import type { EventValue } from "./types";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/u;
const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)$/u;
export const PROMOTION_HINT_PREFIX = "wide_events.promote.";
const BASELINE_COLUMN_SET: ReadonlySet<string> = new Set(BASELINE_COLUMN_NAMES);

export function sanitizeIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (trimmed.length === 0) {
    throw new Error("Identifier cannot be empty");
  }

  if (!IDENTIFIER_PATTERN.test(trimmed)) {
    throw new Error(`Unsupported identifier: ${identifier}`);
  }

  return trimmed.replace(/"/gu, "");
}

export function quoteIdentifier(identifier: string): string {
  return `"${sanitizeIdentifier(identifier)}"`;
}

export function isBaselineColumn(field: string): field is BaselineColumnName {
  return BASELINE_COLUMN_SET.has(field);
}

export function isPrimitiveEventValue(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function isPromotionHintAttribute(
  key: string,
  value: unknown
): key is `${typeof PROMOTION_HINT_PREFIX}${string}` {
  return key.startsWith(PROMOTION_HINT_PREFIX) && value === true;
}

export function getPromotionHintKey(key: string): string {
  return key.slice(PROMOTION_HINT_PREFIX.length);
}

export function parseDurationWindow(value: string): number {
  const match = DURATION_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Unsupported duration window: ${value}`);
  }

  const amountToken = match[1];
  const unit = match[2];
  if (!amountToken || !unit) {
    throw new Error(`Unsupported duration window: ${value}`);
  }

  const amount = Number.parseInt(amountToken, 10);

  switch (unit) {
    case "ms":
      return amount;
    case "s":
      return amount * 1_000;
    case "m":
      return amount * 60_000;
    case "h":
      return amount * 3_600_000;
    case "d":
      return amount * 86_400_000;
    default:
      throw new Error(`Unsupported duration unit: ${unit}`);
  }
}

export function normalizeEventPrimitive(value: unknown): EventValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "undefined") {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeEventPrimitive(entry));
  }

  if (typeof value === "object") {
    const normalized: Record<string, EventValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      normalized[key] = normalizeEventPrimitive(entry);
    }
    return normalized;
  }

  return JSON.stringify(value);
}

export function assertRecord(
  value: unknown,
  label: string
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}
