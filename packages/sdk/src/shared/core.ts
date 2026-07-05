import {
  isBaselineColumn,
  normalizeEventPrimitive,
  type DynamicEventAttributes,
  type EventValue,
  type ProjectFieldTypes,
  type ProjectFields,
  type WideEvent,
} from "@wide-events/internal";
import { normalizeAttributes, type AnnotateOptions, type AnnotationAttributes } from "./attributes.js";
import { wrapFetch as wrapFetchInstrumentation } from "./instrumentation/fetch.js";
import { postJson } from "./http.js";
import { createCorrelationId, createEventId } from "./ids.js";
import {
  ProjectRulesManager,
  type ProjectExtractionRule,
} from "./project-rules.js";
import type { ProjectExtractionMetadata } from "./project-extraction.js";
import {
  ProjectRoutingManager,
  type AnnotateProjectOptions,
  type ProjectAnnotationFields,
  type ProjectRoutingOption,
} from "./projects.js";

export interface WideEventContext {
  event: WideEvent;
  attributes: DynamicEventAttributes;
  promote: Set<string>;
  startedAt: number;
}

export interface ContextStorage {
  getStore(): WideEventContext | undefined;
  run<T>(context: WideEventContext, callback: () => T): T;
}

export interface WideEventSink {
  write(events: WideEvent[]): Promise<void> | void;
}

export interface CoreWideEventsOptions {
  serviceName: string;
  environment: string;
  collectorUrl?: string | undefined;
  apiKey?: string | undefined;
  apiUrl?: string | undefined;
  sampleRate: number;
  disabled: boolean;
  batchSize: number;
  projects: ProjectRoutingOption;
  fetchImpl?: typeof fetch | undefined;
  sink?: WideEventSink | undefined;
}

export interface RecordErrorOptions {
  slug?: string | undefined;
  handled?: boolean | undefined;
}

export class CoreWideEvents {
  private readonly fetchImpl: typeof fetch;
  private readonly projectRouting: ProjectRoutingManager;
  private readonly projectRules: ProjectRulesManager;
  private readonly queue: WideEvent[] = [];
  private patchedFetch: typeof fetch | null = null;

  constructor(
    readonly options: CoreWideEventsOptions,
    private readonly storage: ContextStorage,
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.projectRules = new ProjectRulesManager({
      projects: options.projects,
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
      fetchImpl: this.fetchImpl,
    });
    this.projectRouting = new ProjectRoutingManager({
      projects: options.projects,
      resolveProjects: () => this.projectRules.getProjects(),
    });
  }

  createContext(initial: Partial<WideEvent> = {}): WideEventContext {
    const startedAt = Date.now();
    return {
      event: {
        event_id: initial.event_id ?? createEventId(),
        correlation_id: initial.correlation_id ?? createCorrelationId(),
        parent_event_id: initial.parent_event_id ?? null,
        ts: initial.ts ?? new Date(startedAt).toISOString(),
        duration_ms: initial.duration_ms ?? null,
        main: initial.main ?? true,
        sample_rate: initial.sample_rate ?? this.options.sampleRate,
        "service.name": initial["service.name"] ?? this.options.serviceName,
        "service.environment": initial["service.environment"] ?? this.options.environment,
        "service.version": initial["service.version"] ?? null,
        "http.route": initial["http.route"] ?? null,
        "http.status_code": initial["http.status_code"] ?? null,
        "http.request.method": initial["http.request.method"] ?? null,
        error: initial.error ?? null,
        "exception.slug": initial["exception.slug"] ?? null,
        project_id: initial.project_id,
        project_rule_version: initial.project_rule_version,
        project_fields: initial.project_fields,
        project_field_types: initial.project_field_types,
      },
      attributes: { ...(initial.attributes ?? {}) },
      promote: new Set(initial.promote ?? []),
      startedAt,
    };
  }

  run<T>(initial: Partial<WideEvent>, callback: () => T): T {
    if (this.options.disabled || !this.shouldSample()) {
      return callback();
    }

    return this.storage.run(this.createContext(initial), callback);
  }

  current(): WideEvent | undefined {
    const context = this.storage.getStore();
    return context ? materializeEvent(context) : undefined;
  }

  annotate<T extends AnnotationAttributes>(
    attributes: T,
    options?: AnnotateOptions<T>,
  ): void {
    const context = this.storage.getStore();
    if (!context || this.options.disabled) {
      return;
    }

    for (const [key, value] of Object.entries(normalizeAttributes(attributes))) {
      setField(context, key, value);
    }

    for (const key of options?.promote ?? []) {
      if (!(key in attributes)) {
        throw new Error(`annotate() promote key "${key}" is missing from attributes`);
      }
      if (isBaselineColumn(key)) {
        throw new Error(`annotate() cannot promote baseline column "${key}"`);
      }
      context.promote.add(key);
    }
  }

  annotateProject<TFields extends ProjectAnnotationFields>(
    fields: TFields,
    options?: AnnotateProjectOptions<TFields>,
  ): void {
    const context = this.storage.getStore();
    if (!context || this.options.disabled) {
      return;
    }

    const annotation = this.projectRouting.prepareProjectAnnotation(fields, options);
    context.event.project_id = annotation.project_id ?? context.event.project_id;
    context.event.project_rule_version =
      annotation.project_rule_version ?? context.event.project_rule_version;
    context.event.project_fields = {
      ...(context.event.project_fields ?? {}),
      ...annotation.project_fields,
    };
    context.event.project_field_types = {
      ...(context.event.project_field_types ?? {}),
      ...annotation.project_field_types,
    };
  }

  async getProjectRules(): Promise<readonly ProjectExtractionRule[]> {
    return await this.projectRules.getRules();
  }

  applyProjectMetadata(metadata: ProjectExtractionMetadata): void {
    const context = this.storage.getStore();
    if (!context || this.options.disabled) {
      return;
    }

    context.event.project_id = metadata.project_id;
    context.event.project_rule_version = metadata.project_rule_version;
    context.event.project_fields = {
      ...(context.event.project_fields ?? {}),
      ...(metadata.project_fields ?? {}),
    };
    context.event.project_field_types = {
      ...(context.event.project_field_types ?? {}),
      ...(metadata.project_field_types ?? {}),
    };
  }

  push(key: string, value: EventValue): void {
    const context = this.storage.getStore();
    if (!context || this.options.disabled) {
      return;
    }

    const existing = context.attributes[key];
    const normalized = normalizeEventPrimitive(value);
    context.attributes[key] = Array.isArray(existing)
      ? [...existing, normalized]
      : [normalized];
  }

  recordError(error: unknown, options: RecordErrorOptions = {}): void {
    const context = this.storage.getStore();
    if (!context || this.options.disabled) {
      return;
    }

    const normalized = normalizeError(error, options);
    context.event.error = true;
    context.event["exception.slug"] = normalized["exception.slug"];
    for (const [key, value] of Object.entries(normalized)) {
      if (key === "exception.slug") {
        continue;
      }
      context.attributes[key] = value;
    }
  }

  finishCurrent(extra: Partial<WideEvent> = {}): void {
    const context = this.storage.getStore();
    if (!context || this.options.disabled) {
      return;
    }

    for (const [key, value] of Object.entries(extra)) {
      if (typeof value !== "undefined") {
        setField(context, key, normalizeEventPrimitive(value));
      }
    }

    if (context.event.duration_ms === null || typeof context.event.duration_ms === "undefined") {
      context.event.duration_ms = Date.now() - context.startedAt;
    }

    this.enqueue(materializeEvent(context));
  }

  enqueue(event: WideEvent): void {
    if (this.options.disabled) {
      return;
    }

    this.queue.push(event);
    if (this.queue.length >= this.options.batchSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0 || this.options.disabled) {
      return;
    }

    const events = this.queue.splice(0, this.queue.length);
    const preparedEvents = await this.projectRouting.prepareEvents(events);
    if (this.options.sink) {
      await this.options.sink.write(preparedEvents);
      return;
    }

    if (!this.options.collectorUrl) {
      return;
    }

    await postJson(
      this.fetchImpl,
      `${this.options.collectorUrl.replace(/\/$/u, "")}/v1/events`,
      { events: preparedEvents },
    );
  }

  async shutdown(): Promise<void> {
    await this.flush();
  }

  wrapFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
    return wrapFetchInstrumentation(this, fetchImpl);
  }

  instrumentFetch(): void {
    if (this.patchedFetch) {
      return;
    }

    this.patchedFetch = globalThis.fetch;
    globalThis.fetch = this.wrapFetch(globalThis.fetch);
  }

  restoreFetch(): void {
    if (!this.patchedFetch) {
      return;
    }

    globalThis.fetch = this.patchedFetch;
    this.patchedFetch = null;
  }

  private shouldSample(): boolean {
    return this.options.sampleRate <= 1 || Math.random() < 1 / this.options.sampleRate;
  }
}

export function materializeEvent(context: WideEventContext): WideEvent {
  return {
    ...context.event,
    attributes: { ...context.attributes },
    promote: [...context.promote],
  };
}

function setField(context: WideEventContext, key: string, value: EventValue): void {
  switch (key) {
    case "event_id":
      context.event.event_id = typeof value === "string" ? value : context.event.event_id;
      break;
    case "correlation_id":
      context.event.correlation_id = typeof value === "string" ? value : context.event.correlation_id;
      break;
    case "parent_event_id":
      context.event.parent_event_id = typeof value === "string" ? value : null;
      break;
    case "ts":
      context.event.ts = typeof value === "string" ? value : context.event.ts;
      break;
    case "service.name":
      context.event["service.name"] = typeof value === "string" ? value : null;
      break;
    case "service.environment":
      context.event["service.environment"] = typeof value === "string" ? value : null;
      break;
    case "service.version":
      context.event["service.version"] = typeof value === "string" ? value : null;
      break;
    case "http.route":
      context.event["http.route"] = typeof value === "string" ? value : null;
      break;
    case "http.request.method":
      context.event["http.request.method"] = typeof value === "string" ? value : null;
      break;
    case "exception.slug":
      context.event["exception.slug"] = typeof value === "string" ? value : null;
      break;
    case "user.id":
      context.event["user.id"] = typeof value === "string" ? value : null;
      break;
    case "user.type":
      context.event["user.type"] = typeof value === "string" ? value : null;
      break;
    case "user.org.id":
      context.event["user.org.id"] = typeof value === "string" ? value : null;
      break;
    case "name":
    case "type":
      context.event[key] = typeof value === "string" ? value : undefined;
      break;
    case "duration_ms":
      context.event.duration_ms = typeof value === "number" ? value : null;
      break;
    case "main":
      context.event.main = typeof value === "boolean" ? value : context.event.main;
      break;
    case "sample_rate":
      context.event.sample_rate = typeof value === "number" ? Math.trunc(value) : context.event.sample_rate;
      break;
    case "http.status_code":
      context.event["http.status_code"] = typeof value === "number" ? Math.trunc(value) : null;
      break;
    case "error":
      context.event.error = typeof value === "boolean" ? value : null;
      break;
    case "project_id":
      context.event.project_id = typeof value === "string" ? value : undefined;
      break;
    case "project_rule_version":
      context.event.project_rule_version = typeof value === "string" ? value : undefined;
      break;
    case "project_fields":
      context.event.project_fields = toProjectFields(value);
      break;
    case "project_field_types":
      context.event.project_field_types = toProjectFieldTypes(value);
      break;
    default:
      context.attributes[key] = value;
      break;
  }
}

function toProjectFields(value: EventValue): ProjectFields | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as ProjectFields;
}

function toProjectFieldTypes(value: EventValue): ProjectFieldTypes | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const fieldTypes: ProjectFieldTypes = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      entry === "BOOLEAN" ||
      entry === "BIGINT" ||
      entry === "DOUBLE" ||
      entry === "VARCHAR" ||
      entry === "JSON"
    ) {
      fieldTypes[key] = entry;
    }
  }

  return fieldTypes;
}

function normalizeError(
  error: unknown,
  options: RecordErrorOptions,
): DynamicEventAttributes & { "exception.slug": string } {
  const asError = error instanceof Error ? error : new Error(String(error));
  return {
    "exception.slug": options.slug ?? asError.name,
    "exception.type": asError.name,
    "exception.message": asError.message,
    "exception.stack": asError.stack ?? null,
    "exception.handled": options.handled ?? false,
  };
}
