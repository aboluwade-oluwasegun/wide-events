import { randomUUID } from "node:crypto";
import {
  isBaselineColumn,
  normalizeEventPrimitive,
  type DynamicEventAttributes,
  type EventValue,
  type InferredAttributeType,
  type ProjectEventRow,
  type ProjectFieldTypes,
  type StoredEventRow,
  type WideEvent,
  type WideEventBatch,
} from "@wide-events/internal";

type NormalizedEventBase = Omit<
  StoredEventRow,
  "attributes_overflow" | "promoted_attribute_hints"
>;

const EVENT_META_KEYS = new Set([
  "attributes",
  "promote",
  "project_id",
  "project_rule_version",
  "project_fields",
  "project_field_types",
]);

export interface NormalizedEventBatch {
  defaultRows: StoredEventRow[];
  projectRows: ProjectEventRow[];
}

export class EventNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventNormalizationError";
  }
}

export function normalizeEventBatch(batch: WideEventBatch): StoredEventRow[] {
  const normalized = normalizeEventBatchForIngest(batch);
  if (normalized.projectRows.length > 0) {
    throw new EventNormalizationError("Project events require project_events storage");
  }
  return normalized.defaultRows;
}

export function normalizeEventBatchForIngest(
  batch: WideEventBatch,
): NormalizedEventBatch {
  const defaultRows: StoredEventRow[] = [];
  const projectRows: ProjectEventRow[] = [];

  for (const event of batch.events) {
    if (hasProjectMetadata(event)) {
      projectRows.push(normalizeProjectEvent(event));
      continue;
    }

    defaultRows.push(normalizeEvent(event));
  }

  return { defaultRows, projectRows };
}

export function normalizeEvent(event: WideEvent): StoredEventRow {
  if (hasProjectMetadata(event)) {
    throw new EventNormalizationError("Project events require project_events storage");
  }

  const row: StoredEventRow = {
    ...normalizeEventBase(event),
    attributes_overflow: normalizeDefaultOverflow(event),
    promoted_attribute_hints: [...new Set(event.promote ?? [])],
  };

  return row;
}

export function normalizeProjectEvent(event: WideEvent): ProjectEventRow {
  const projectId = event.project_id;
  if (!projectId) {
    throw new EventNormalizationError("Project metadata requires project_id");
  }

  const projectFields = event.project_fields;
  if (!projectFields) {
    throw new EventNormalizationError(
      `Project event "${projectId}" requires project_fields`,
    );
  }

  const projectFieldTypes = event.project_field_types;
  if (!projectFieldTypes) {
    throw new EventNormalizationError(
      `Project event "${projectId}" requires project_field_types`,
    );
  }

  validateProjectFieldTypes(projectFields, projectFieldTypes);

  return {
    ...normalizeEventBase(event),
    project_id: projectId,
    project_rule_version: event.project_rule_version ?? null,
    project_fields: normalizeProjectFields(projectFields),
    project_field_types: projectFieldTypes,
  };
}

function normalizeEventBase(event: WideEvent): NormalizedEventBase {
  const row: NormalizedEventBase = {
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
  };

  for (const [key, value] of Object.entries(event.attributes ?? {})) {
    if (isBaselineColumn(key)) {
      applyBaselineAttribute(row, key, value);
    }
  }

  return row;
}

function normalizeDefaultOverflow(event: WideEvent): DynamicEventAttributes {
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
    if (!isBaselineColumn(key)) {
      overflow[key] = normalizeEventPrimitive(value);
    }
  }

  return overflow;
}

function normalizeProjectFields(fields: DynamicEventAttributes): DynamicEventAttributes {
  const normalized: DynamicEventAttributes = {};
  for (const [key, value] of Object.entries(fields)) {
    normalized[key] = normalizeEventPrimitive(value);
  }
  return normalized;
}

function hasProjectMetadata(event: WideEvent): boolean {
  return (
    typeof event.project_id !== "undefined" ||
    typeof event.project_rule_version !== "undefined" ||
    typeof event.project_fields !== "undefined" ||
    typeof event.project_field_types !== "undefined"
  );
}

function applyBaselineAttribute(
  row: NormalizedEventBase,
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

function validateProjectFieldTypes(
  fields: DynamicEventAttributes,
  fieldTypes: ProjectFieldTypes,
): void {
  for (const key of Object.keys(fields)) {
    const type = fieldTypes[key];
    if (!type) {
      throw new EventNormalizationError(
        `Project field "${key}" is missing a declared type`,
      );
    }

    const value = fields[key];
    if (!matchesProjectFieldType(value, type)) {
      throw new EventNormalizationError(
        `Project field "${key}" does not match declared type ${type}`,
      );
    }
  }

  for (const key of Object.keys(fieldTypes)) {
    if (!(key in fields)) {
      throw new EventNormalizationError(
        `Project field type "${key}" has no matching project field`,
      );
    }
  }
}

function matchesProjectFieldType(
  value: EventValue | undefined,
  type: InferredAttributeType,
): boolean {
  if (value === null || typeof value === "undefined") {
    return true;
  }

  switch (type) {
    case "BOOLEAN":
      return typeof value === "boolean";
    case "BIGINT":
      return typeof value === "number" && Number.isInteger(value);
    case "DOUBLE":
      return typeof value === "number" && Number.isFinite(value);
    case "VARCHAR":
      return typeof value === "string";
    case "JSON":
      return true;
    default:
      return assertNever(type);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported project field type: ${String(value)}`);
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
