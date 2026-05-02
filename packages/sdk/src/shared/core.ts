import {
  isBaselineColumn,
  normalizeEventPrimitive,
  type DynamicEventAttributes,
  type EventValue,
  type WideEvent,
} from "@wide-events/internal";
import { normalizeAttributes, type AnnotateOptions, type AnnotationAttributes } from "./attributes";
import { postJson } from "./http";
import { createCorrelationId, createEventId } from "./ids";

type FetchInput = Parameters<typeof fetch>[0];

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
  sampleRate: number;
  disabled: boolean;
  batchSize: number;
  fetchImpl?: typeof fetch | undefined;
  sink?: WideEventSink | undefined;
}

export interface RecordErrorOptions {
  slug?: string | undefined;
  handled?: boolean | undefined;
}

export class CoreWideEvents {
  private readonly fetchImpl: typeof fetch;
  private readonly queue: WideEvent[] = [];
  private patchedFetch: typeof fetch | null = null;

  constructor(
    readonly options: CoreWideEventsOptions,
    private readonly storage: ContextStorage,
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
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
    if (this.options.sink) {
      await this.options.sink.write(events);
      return;
    }

    if (!this.options.collectorUrl) {
      return;
    }

    await postJson(
      this.fetchImpl,
      `${this.options.collectorUrl.replace(/\/$/u, "")}/v1/events`,
      { events },
    );
  }

  async shutdown(): Promise<void> {
    await this.flush();
  }

  wrapFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
    return (async (input: FetchInput, init?: RequestInit) => {
      const startedAt = performance.now();
      const requestInfo = describeFetchRequest(input, init);
      try {
        const response = await fetchImpl(input, init);
        this.push("http.client.requests", {
          ...requestInfo,
          status_code: response.status,
          duration_ms: performance.now() - startedAt,
        });
        return response;
      } catch (error) {
        this.push("http.client.errors", {
          ...requestInfo,
          duration_ms: performance.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        this.recordError(error, { slug: "fetch_failed", handled: false });
        throw error;
      }
    }) as typeof fetch;
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
    default:
      context.attributes[key] = value;
      break;
  }
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

function describeFetchRequest(
  input: FetchInput,
  init?: RequestInit,
): DynamicEventAttributes {
  const url = getFetchUrl(input);
  const parsed = safeUrl(url);
  return {
    method: init?.method ?? getFetchMethod(input) ?? "GET",
    url: parsed ? `${parsed.origin}${parsed.pathname}` : url,
    host: parsed?.host ?? null,
    path: parsed?.pathname ?? null,
  };
}

function getFetchUrl(input: FetchInput): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function getFetchMethod(input: FetchInput): string | null {
  return typeof input === "object" && "method" in input ? input.method : null;
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
