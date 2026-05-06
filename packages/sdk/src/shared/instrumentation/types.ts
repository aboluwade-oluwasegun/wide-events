import type { EventValue } from "@wide-events/internal";

/** Narrow surface used by auto-instrumentation modules (avoid coupling to WideEvents internals). */
export interface InstrumentationHooks {
  push(key: string, value: EventValue): void;
  recordError(error: unknown, options?: { slug?: string; handled?: boolean }): void;
}
