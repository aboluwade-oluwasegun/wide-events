import type { DynamicEventAttributes } from "@wide-events/internal";
import type { InstrumentationHooks } from "./types.js";

type FetchInput = Parameters<typeof fetch>[0];

export function wrapFetch(hooks: InstrumentationHooks, fetchImpl: typeof fetch): typeof fetch {
  return (async (input: FetchInput, init?: RequestInit) => {
    const startedAt = performance.now();
    const requestInfo = describeFetchRequest(input, init);
    try {
      const response = await fetchImpl(input, init);
      pushFetchSuccess(hooks, requestInfo, response.status, performance.now() - startedAt);
      return response;
    } catch (error) {
      pushFetchError(hooks, requestInfo, error, performance.now() - startedAt);
      hooks.recordError(error, { slug: "fetch_failed", handled: false });
      throw error;
    }
  }) as typeof fetch;
}

function pushFetchSuccess(
  hooks: InstrumentationHooks,
  requestInfo: DynamicEventAttributes,
  statusCode: number,
  durationMs: number,
): void {
  hooks.push("http.client.requests", {
    ...requestInfo,
    status_code: statusCode,
    duration_ms: durationMs,
  });
}

function pushFetchError(
  hooks: InstrumentationHooks,
  requestInfo: DynamicEventAttributes,
  error: unknown,
  durationMs: number,
): void {
  hooks.push("http.client.errors", {
    ...requestInfo,
    duration_ms: durationMs,
    error: error instanceof Error ? error.message : String(error),
  });
}

function describeFetchRequest(input: FetchInput, init?: RequestInit): DynamicEventAttributes {
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
