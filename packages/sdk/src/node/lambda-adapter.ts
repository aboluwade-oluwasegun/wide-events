import type { WideEvent } from "@wide-events/internal";
import type { CoreWideEvents } from "../shared/core.js";
import { isRecord } from "./http-common.js";

export function createLambdaEvent(event: unknown): Partial<WideEvent> {
  const record = isRecord(event) ? event : {};
  const requestContext = isRecord(record["requestContext"])
    ? record["requestContext"]
    : {};
  const http = isRecord(requestContext["http"]) ? requestContext["http"] : {};
  return {
    type: "lambda",
    name: "lambda invocation",
    "http.request.method": typeof http["method"] === "string" ? http["method"] : null,
    "http.route": typeof record["rawPath"] === "string" ? record["rawPath"] : null,
    attributes: {
      "lambda.request_id":
        typeof requestContext["requestId"] === "string"
          ? requestContext["requestId"]
          : null,
    },
  };
}

export function annotateLambdaResult(core: CoreWideEvents, result: unknown): void {
  if (!isRecord(result) || typeof result["statusCode"] !== "number") {
    return;
  }

  const statusCode = result["statusCode"];
  core.annotate({
    "http.status_code": statusCode,
    error: statusCode >= 500,
    "exception.slug": statusCode >= 500 ? `http_${statusCode}` : undefined,
  });
}
