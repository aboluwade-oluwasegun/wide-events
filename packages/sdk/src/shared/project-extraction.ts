import {
  normalizeEventPrimitive,
  type ProjectFieldTypes,
  type ProjectFields,
  type WideEvent,
} from "@wide-events/internal";
import type { ProjectExtractionRule, ProjectRuleField } from "./project-rules.js";

const MISSING = Symbol("missing project extraction value");

type MissingValue = typeof MISSING;
interface FoundValue {
  readonly value: unknown;
}

type ExtractedValue = FoundValue | MissingValue;

export interface ProjectExtractionRequest {
  method: string;
  path: string;
  body?: unknown;
  query?: unknown;
  params?: unknown;
  headers?: Headers | Record<string, unknown> | undefined;
}

export interface ProjectExtractionResponse {
  body?: unknown;
  status?: number | undefined;
}

export interface ProjectExtractionContext {
  request: ProjectExtractionRequest;
  response?: ProjectExtractionResponse | undefined;
}

export type ProjectExtractionMetadata = Pick<
  WideEvent,
  "project_fields" | "project_field_types" | "project_id" | "project_rule_version"
>;

export function extractProjectMetadata(
  rules: readonly ProjectExtractionRule[],
  context: ProjectExtractionContext,
): ProjectExtractionMetadata | null {
  const rule = findMatchingProjectRule(rules, context.request);
  if (!rule) {
    return null;
  }

  const projectFields: ProjectFields = {};
  const projectFieldTypes: ProjectFieldTypes = {};

  for (const field of rule.fields) {
    const value = extractRuleField(field, context);
    if (value === MISSING && field.optional) {
      continue;
    }

    projectFields[field.field] =
      value === MISSING ? null : normalizeEventPrimitive(value.value);
    projectFieldTypes[field.field] = field.type;
  }

  return {
    project_id: rule.project_id,
    project_rule_version: rule.project_rule_version,
    project_fields: projectFields,
    project_field_types: projectFieldTypes,
  };
}

export function findMatchingProjectRule(
  rules: readonly ProjectExtractionRule[],
  request: Pick<ProjectExtractionRequest, "method" | "path">,
): ProjectExtractionRule | null {
  const method = request.method.toUpperCase();
  const path = normalizeRequestPath(request.path);

  return (
    rules.find(
      (rule) => rule.match.method === method && rule.match.path === path,
    ) ?? null
  );
}

function extractRuleField(
  field: ProjectRuleField,
  context: ProjectExtractionContext,
): ExtractedValue {
  switch (field.source) {
    case "request.body":
      return readDotPath(context.request.body, requirePath(field));
    case "request.query":
      return readDotPath(context.request.query, requirePath(field));
    case "request.params":
      return readDotPath(context.request.params, requirePath(field));
    case "request.headers":
      return readHeader(context.request.headers, requirePath(field));
    case "response.body":
      return readDotPath(context.response?.body, requirePath(field));
    case "response.status":
      return context.response && typeof context.response.status !== "undefined"
        ? found(context.response.status)
        : MISSING;
    default:
      return assertNever(field.source);
  }
}

function requirePath(field: ProjectRuleField): string {
  if (typeof field.path === "undefined") {
    throw new Error(`${field.source} project extraction field requires a path`);
  }

  return field.path;
}

function readDotPath(root: unknown, path: string): ExtractedValue {
  if (root instanceof URLSearchParams) {
    return root.has(path) ? found(root.get(path)) : MISSING;
  }

  const segments = path.split(".");
  if (segments.some((segment) => segment.length === 0)) {
    return MISSING;
  }

  let current: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return MISSING;
      }
      current = current[index];
      continue;
    }

    if (!isObjectRecord(current)) {
      return MISSING;
    }

    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return MISSING;
    }

    current = current[segment];
  }

  return found(current);
}

function readHeader(
  headers: Headers | Record<string, unknown> | undefined,
  name: string,
): ExtractedValue {
  if (!headers) {
    return MISSING;
  }

  if (headers instanceof Headers) {
    const value = headers.get(name);
    return value === null ? MISSING : found(value);
  }

  if (Object.prototype.hasOwnProperty.call(headers, name)) {
    return normalizeHeaderValue(headers[name]);
  }

  const lowerName = name.toLowerCase();
  const matchingKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === lowerName,
  );
  if (!matchingKey) {
    return MISSING;
  }

  return normalizeHeaderValue(headers[matchingKey]);
}

function normalizeHeaderValue(value: unknown): ExtractedValue {
  if (typeof value === "undefined") {
    return MISSING;
  }

  if (Array.isArray(value)) {
    return found(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .join(", "),
    );
  }

  return found(value);
}

function normalizeRequestPath(path: string): string {
  try {
    return new URL(path, "http://wide-events.local").pathname;
  } catch {
    return path.split("?")[0] ?? path;
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function found(value: unknown): FoundValue {
  return { value };
}

function assertNever(value: never): never {
  throw new Error(`Unsupported project rule field source: ${String(value)}`);
}
