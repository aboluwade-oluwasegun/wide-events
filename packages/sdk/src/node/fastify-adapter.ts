import type { WideEvent } from "@wide-events/internal";
import { extractProjectMetadata } from "../shared/project-extraction.js";
import type { ProjectExtractionRule } from "../shared/project-rules.js";
import type { FastifyReplyLike, FastifyRequestLike } from "./framework-types.js";
import { getPathname } from "./http-common.js";

export function createFastifyRequestEvent(request: FastifyRequestLike): Partial<WideEvent> {
  const method = request.method ?? "GET";
  const path = getFastifyPath(request);
  return {
    type: "request",
    name: `${method} ${path}`,
    "http.request.method": method,
    "http.route": path,
  };
}

export function extractFastifyProjectMetadata(
  rules: readonly ProjectExtractionRule[],
  request: FastifyRequestLike,
  responseBody: unknown,
  statusCode: number,
) {
  return extractProjectMetadata(rules, {
    request: {
      method: request.method ?? "GET",
      path: getFastifyPath(request),
      body: request.body,
      query: request.query,
      params: request.params,
      headers: request.headers,
    },
    response: {
      body: responseBody,
      status: statusCode,
    },
  });
}

export function getFastifyPath(request: FastifyRequestLike): string {
  if (typeof request.routeOptions?.url === "string") {
    return request.routeOptions.url;
  }

  if (typeof request.routerPath === "string") {
    return request.routerPath;
  }

  return getPathname(request.url ?? "/");
}

export function getFastifyStatusCode(reply: FastifyReplyLike): number {
  return reply.statusCode ?? reply.raw?.statusCode ?? 200;
}

export function normalizeFastifyPayload(payload: unknown): unknown {
  if (typeof payload !== "string") {
    return payload;
  }

  const trimmed = payload.trim();
  if (
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return payload;
  }

  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return payload;
  }
}
