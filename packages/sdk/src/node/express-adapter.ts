import type { WideEvent } from "@wide-events/internal";
import { extractProjectMetadata } from "../shared/project-extraction.js";
import type { ProjectExtractionRule } from "../shared/project-rules.js";
import type { ExpressRequestLike, ExpressResponseLike } from "./framework-types.js";
import { getPathname } from "./http-common.js";

export function createExpressRequestEvent(request: ExpressRequestLike): Partial<WideEvent> {
  const method = request.method ?? "GET";
  const path = getExpressPath(request);
  return {
    type: "request",
    name: `${method} ${path}`,
    "http.request.method": method,
    "http.route": path,
  };
}

export function extractExpressProjectMetadata(
  rules: readonly ProjectExtractionRule[],
  request: ExpressRequestLike,
  responseBody: unknown,
  statusCode: number,
) {
  return extractProjectMetadata(rules, {
    request: {
      method: request.method ?? "GET",
      path: getExpressPath(request),
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

export function wrapExpressResponseBody(response: ExpressResponseLike): { body: unknown } {
  const capture: { body: unknown; lockedByJson: boolean } = {
    body: undefined,
    lockedByJson: false,
  };
  const originalJson = response.json;
  const originalSend = response.send;

  if (originalJson) {
    response.json = function json(this: ExpressResponseLike, body: unknown): unknown {
      capture.body = body;
      capture.lockedByJson = true;
      return originalJson.call(this, body);
    };
  }

  if (originalSend) {
    response.send = function send(this: ExpressResponseLike, body?: unknown): unknown {
      if (!capture.lockedByJson) {
        capture.body = body;
      }
      return originalSend.call(this, body);
    };
  }

  return capture;
}

export function getExpressPath(request: ExpressRequestLike): string {
  if (typeof request.path === "string") {
    return request.path;
  }

  return getPathname(request.originalUrl ?? request.url ?? "/");
}
