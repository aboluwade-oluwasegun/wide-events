import type { WideEvent } from "@wide-events/internal";

export interface RequestEventInput {
  method?: string | undefined;
  url?: string | undefined;
}

export function createRequestEvent(request: RequestEventInput): Partial<WideEvent> {
  const url = request.url ?? "/";
  return {
    type: "request",
    name: `${request.method ?? "GET"} ${getPathname(url)}`,
    "http.request.method": request.method ?? "GET",
    "http.route": getPathname(url),
  };
}

export function getPathname(value: string): string {
  try {
    return new URL(value, "http://localhost").pathname;
  } catch {
    return value;
  }
}

export function parseJsonLikeText(text: string): unknown {
  const trimmed = text.trim();
  if (
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return text;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return text;
  }
}

export function urlSearchParamsToRecord(params: URLSearchParams): Record<string, string | string[]> {
  const record: Record<string, string | string[]> = {};
  for (const [key, value] of params) {
    const existing = record[key];
    if (typeof existing === "undefined") {
      record[key] = value;
    } else if (Array.isArray(existing)) {
      record[key] = [...existing, value];
    } else {
      record[key] = [existing, value];
    }
  }

  return record;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
