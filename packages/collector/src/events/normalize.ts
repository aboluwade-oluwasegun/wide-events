import { randomUUID } from "node:crypto";
import {
  isBaselineColumn,
  normalizeEventPrimitive,
  type DynamicEventAttributes,
  type StoredEventRow,
  type WideEvent,
  type WideEventBatch,
} from "@wide-events/internal";

const EVENT_META_KEYS = new Set(["attributes", "promote"]);

export function normalizeEventBatch(batch: WideEventBatch): StoredEventRow[] {
  return batch.events.map(normalizeEvent);
}

export function normalizeEvent(event: WideEvent): StoredEventRow {
  const row: StoredEventRow = {
    event_id: event.event_id ?? randomUUID(),
    correlation_id: event.correlation_id ?? randomUUID(),
    parent_event_id: event.parent_event_id ?? null,
    ts: event.ts ?? new Date().toISOString(),
    duration_ms: event.duration_ms ?? null,
    main: event.main ?? true,
    sample_rate: normalizePositiveInteger(event.sample_rate, 1),
    "service.name": event["service.name"] ?? null,
    "service.environment": event["service.environment"] ?? null,
    "service.version": event["service.version"] ?? null,
    "http.route": event["http.route"] ?? null,
    "http.status_code": normalizeNullableInteger(event["http.status_code"]),
    "http.request.method": event["http.request.method"] ?? null,
    error: event.error ?? null,
    "exception.slug": event["exception.slug"] ?? null,
    "user.id": event["user.id"] ?? null,
    "user.type": event["user.type"] ?? null,
    "user.org.id": event["user.org.id"] ?? null,
    attributes_overflow: {},
    promoted_attribute_hints: [],
  };

  const overflow: DynamicEventAttributes = {};

  for (const [key, value] of Object.entries(event)) {
    if (
      EVENT_META_KEYS.has(key) ||
      isBaselineColumn(key) ||
      typeof value === "undefined"
    ) {
      continue;
    }

    overflow[key] = normalizeEventPrimitive(value);
  }

  for (const [key, value] of Object.entries(event.attributes ?? {})) {
    if (isBaselineColumn(key)) {
      applyBaselineAttribute(row, key, value);
      continue;
    }

    overflow[key] = normalizeEventPrimitive(value);
  }

  row.attributes_overflow = overflow;
  row.promoted_attribute_hints = [...new Set(event.promote ?? [])];
  return row;
}

function applyBaselineAttribute(
  row: StoredEventRow,
  key: string,
  value: DynamicEventAttributes[string],
): void {
  switch (key) {
    case "event_id":
      row.event_id = typeof value === "string" ? value : row.event_id;
      break;
    case "correlation_id":
      row.correlation_id = typeof value === "string" ? value : row.correlation_id;
      break;
    case "parent_event_id":
      row.parent_event_id = typeof value === "string" ? value : null;
      break;
    case "ts":
      row.ts = typeof value === "string" ? value : row.ts;
      break;
    case "service.name":
      row["service.name"] = typeof value === "string" ? value : null;
      break;
    case "service.environment":
      row["service.environment"] = typeof value === "string" ? value : null;
      break;
    case "service.version":
      row["service.version"] = typeof value === "string" ? value : null;
      break;
    case "http.route":
      row["http.route"] = typeof value === "string" ? value : null;
      break;
    case "http.request.method":
      row["http.request.method"] = typeof value === "string" ? value : null;
      break;
    case "exception.slug":
      row["exception.slug"] = typeof value === "string" ? value : null;
      break;
    case "user.id":
      row["user.id"] = typeof value === "string" ? value : null;
      break;
    case "user.type":
      row["user.type"] = typeof value === "string" ? value : null;
      break;
    case "user.org.id":
      row["user.org.id"] = typeof value === "string" ? value : null;
      break;
    case "duration_ms":
      row.duration_ms = typeof value === "number" ? value : null;
      break;
    case "main":
      row.main = typeof value === "boolean" ? value : row.main;
      break;
    case "sample_rate":
      row.sample_rate = normalizePositiveInteger(value, row.sample_rate);
      break;
    case "http.status_code":
      row["http.status_code"] = normalizeNullableInteger(value);
      break;
    case "error":
      row.error = typeof value === "boolean" ? value : null;
      break;
    case "attributes_overflow":
      break;
    default:
      break;
  }
}

function normalizeNullableInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : fallback;
}
