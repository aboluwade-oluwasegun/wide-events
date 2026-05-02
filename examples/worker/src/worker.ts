import type { ExecutionContext } from "@cloudflare/workers-types";
import { WideEvents } from "@wide-events/sdk/edge";

interface Env {
  WIDE_EVENTS_COLLECTOR_URL: string;
  WIDE_EVENTS_ENVIRONMENT?: string;
  WIDE_EVENTS_SERVICE_NAME: string;
}

export function handleWorkerRequest(
  request: Request,
  env: Env,
  executionContext: ExecutionContext
): Promise<Response> {
  const wideEvents = new WideEvents({
    serviceName: env.WIDE_EVENTS_SERVICE_NAME,
    collectorUrl: env.WIDE_EVENTS_COLLECTOR_URL,
    environment: env.WIDE_EVENTS_ENVIRONMENT ?? "development"
  });

  return wideEvents.fetchHandler(request, executionContext, () => {
    wideEvents.annotate({
      "http.route": new URL(request.url).pathname,
      "http.request.method": request.method
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
}

export default {
  fetch: handleWorkerRequest
};
