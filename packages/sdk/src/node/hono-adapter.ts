import type { WideEvent } from "@wide-events/internal";
import {
  extractProjectMetadata,
  findMatchingProjectRule,
} from "../shared/project-extraction.js";
import type { ProjectExtractionRule } from "../shared/project-rules.js";
import type { HonoRequestLike } from "./framework-types.js";
import {
  getPathname,
  isRecord,
  parseJsonLikeText,
  urlSearchParamsToRecord,
} from "./http-common.js";

export function createHonoRequestEvent(request: HonoRequestLike): Partial<WideEvent> {
  const method = getHonoMethod(request);
  const path = getHonoPath(request);
  return {
    type: "request",
    name: `${method} ${path}`,
    "http.request.method": method,
    "http.route": path,
  };
}

export function extractHonoProjectMetadata(
  rules: readonly ProjectExtractionRule[],
  request: HonoRequestLike,
  requestBody: unknown,
  responseBody: unknown,
  statusCode: number,
) {
  return extractProjectMetadata(rules, {
    request: {
      method: getHonoMethod(request),
      path: getHonoPath(request),
      body: requestBody,
      query: getHonoQuery(request),
      params: getHonoParams(request),
      headers: getHonoHeaders(request),
    },
    response: {
      body: responseBody,
      status: statusCode,
    },
  });
}

export function findMatchingHonoProjectRule(
  rules: readonly ProjectExtractionRule[],
  request: HonoRequestLike,
): ProjectExtractionRule | null {
  return findMatchingProjectRule(rules, {
    method: getHonoMethod(request),
    path: getHonoPath(request),
  });
}

export function getHonoMethod(request: HonoRequestLike): string {
  return request.method ?? request.raw?.method ?? "GET";
}

export function getHonoPath(request: HonoRequestLike): string {
  if (typeof request.path === "string") {
    return request.path;
  }

  if (typeof request.raw?.url === "string") {
    return getPathname(request.raw.url);
  }

  return "/";
}

export function getHonoStatusCode(response: Response | undefined): number {
  return response?.status ?? 200;
}

export function ruleUsesSource(
  rule: ProjectExtractionRule | null,
  source: ProjectExtractionRule["fields"][number]["source"],
): boolean {
  return rule?.fields.some((field) => field.source === source) ?? false;
}

export async function readHonoRequestBody(request: HonoRequestLike): Promise<unknown> {
  if (typeof request.body !== "undefined") {
    return request.body;
  }

  const raw = request.raw;
  if (!raw || raw.bodyUsed) {
    return undefined;
  }

  try {
    return await readFetchBody(raw.clone(), raw.headers);
  } catch {
    return undefined;
  }
}

export async function readHonoResponseBody(response: Response | undefined): Promise<unknown> {
  if (!response || response.bodyUsed) {
    return undefined;
  }

  try {
    return await readFetchBody(response.clone(), response.headers);
  } catch {
    return undefined;
  }
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function getHonoQuery(request: HonoRequestLike): unknown {
  const query = callHonoAccessor(request.query);
  if (typeof query !== "undefined") {
    return query;
  }

  if (typeof request.raw?.url !== "string") {
    return undefined;
  }

  try {
    return urlSearchParamsToRecord(new URL(request.raw.url).searchParams);
  } catch {
    return undefined;
  }
}

function getHonoParams(request: HonoRequestLike): unknown {
  return callHonoAccessor(request.param);
}

function getHonoHeaders(request: HonoRequestLike): Headers | Record<string, unknown> | undefined {
  const headers = callHonoAccessor(request.header);
  if (isRecord(headers)) {
    return headers;
  }

  return request.raw?.headers;
}

async function readFetchBody(
  body: Pick<Request, "json" | "text"> | Pick<Response, "json" | "text">,
  headers: Headers,
): Promise<unknown> {
  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    return await body.json();
  }

  const text = await body.text();
  return parseJsonLikeText(text);
}

function callHonoAccessor(
  accessor: ((name?: string) => unknown) | undefined,
): unknown {
  if (!accessor) {
    return undefined;
  }

  try {
    return accessor();
  } catch {
    return undefined;
  }
}
