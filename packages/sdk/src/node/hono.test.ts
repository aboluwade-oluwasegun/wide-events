import type { WideEvent } from "@wide-events/internal";
import { describe, expect, it, vi } from "vitest";
import { WideEvents, type HonoContextLike } from "./index";

describe("WideEvents Hono adapter", () => {
  it("emits project metadata from matching request rules without consuming the request body", async () => {
    const exportedEvents: WideEvent[] = [];
    const wide = createHonoWideEvents(exportedEvents, {
      version: 1,
      rules: [
        {
          project_id: "project_checkout",
          project_rule_version: "rules-v1",
          match: {
            method: "POST",
            path: "/checkout",
          },
          fields: [
            {
              field: "cart.item_count",
              source: "request.body",
              path: "cart.itemCount",
              type: "BIGINT",
            },
          ],
        },
      ],
    });
    const context = createHonoContext({
      method: "POST",
      path: "/checkout",
      url: "https://api.example.com/checkout?coupon=SUMMER",
      body: {
        cart: {
          itemCount: 2,
        },
      },
    });
    let handlerBody: unknown;

    await invokeHono(wide, context, async () => {
      handlerBody = await context.req.raw?.json();
      wide.annotate({ "user.id": "user_123" });
      context.res = new Response("ok", { status: 200 });
    });

    expect(handlerBody).toEqual({
      cart: {
        itemCount: 2,
      },
    });

    await waitFor(() => exportedEvents.length === 1);
    expect(exportedEvents[0]).toEqual(
      expect.objectContaining({
        "http.route": "/checkout",
        project_id: "project_checkout",
        project_rule_version: "rules-v1",
        project_fields: {
          "cart.item_count": 2,
        },
        project_field_types: {
          "cart.item_count": "BIGINT",
        },
        "user.id": "user_123",
      }),
    );
  });

  it("extracts project fields from Hono response bodies without consuming the response", async () => {
    const exportedEvents: WideEvent[] = [];
    const wide = createHonoWideEvents(exportedEvents, {
      version: 1,
      rules: [
        {
          project_id: "project_checkout",
          project_rule_version: "rules-v2",
          match: {
            method: "POST",
            path: "/checkout",
          },
          fields: [
            {
              field: "order.total",
              source: "response.body",
              path: "total",
              type: "DOUBLE",
            },
            {
              field: "response.status",
              source: "response.status",
              type: "BIGINT",
            },
          ],
        },
      ],
    });
    const context = createHonoContext({
      method: "POST",
      path: "/checkout",
      url: "https://api.example.com/checkout",
    });
    const response = new Response(JSON.stringify({ total: 42.5 }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });

    const result = await invokeHono(wide, context, () => {
      context.res = response;
      return response;
    });

    expect(result).toBe(response);
    const parsedResponseBody: unknown = await response.json();
    expect(parsedResponseBody).toEqual({ total: 42.5 });

    await waitFor(() => exportedEvents.length === 1);
    expect(exportedEvents[0]).toEqual(
      expect.objectContaining({
        "http.status_code": 201,
        project_fields: {
          "order.total": 42.5,
          "response.status": 201,
        },
        project_field_types: {
          "order.total": "DOUBLE",
          "response.status": "BIGINT",
        },
      }),
    );
  });

  it("leaves unmatched Hono requests as normal events", async () => {
    const exportedEvents: WideEvent[] = [];
    const wide = createHonoWideEvents(exportedEvents, {
      version: 1,
      rules: [
        {
          project_id: "project_checkout",
          project_rule_version: "rules-v3",
          match: {
            method: "POST",
            path: "/checkout",
          },
          fields: [
            {
              field: "order.total",
              source: "response.body",
              path: "total",
              type: "DOUBLE",
            },
          ],
        },
      ],
    });
    const context = createHonoContext({
      method: "GET",
      path: "/health",
      url: "https://api.example.com/health?full=true",
    });

    await invokeHono(wide, context, () => {
      context.res = new Response("ok", { status: 200 });
    });

    await waitFor(() => exportedEvents.length === 1);
    expect(exportedEvents[0]).toEqual(
      expect.objectContaining({
        "http.route": "/health",
        "http.status_code": 200,
      }),
    );
    expect(exportedEvents[0]?.project_id).toBeUndefined();
    expect(exportedEvents[0]?.project_fields).toBeUndefined();
    expect(exportedEvents[0]?.project_field_types).toBeUndefined();
  });
});

function createHonoWideEvents(
  exportedEvents: WideEvent[],
  rulesDocument: unknown,
): WideEvents {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(rulesDocument), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

  return new WideEvents({
    serviceName: "checkout-api",
    environment: "prod",
    projects: ["project_checkout"],
    projectRules: {
      url: "https://cdn.example.com/wide-events/project-rules.json",
      refreshIntervalMs: 30_000,
    },
    fetchImpl,
    sink: {
      write(events) {
        exportedEvents.push(...events);
      },
    },
  });
}

function createHonoContext({
  method,
  path,
  url,
  body,
  params = {},
}: {
  method: string;
  path: string;
  url: string;
  body?: unknown;
  params?: Record<string, string> | undefined;
}): HonoContextLike {
  const headers: Record<string, string> = {};
  const init: RequestInit = {
    method,
    headers,
  };
  if (typeof body !== "undefined") {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const raw = new Request(url, init);
  return {
    req: {
      raw,
      method,
      path,
      query: () => urlSearchParamsToRecord(new URL(raw.url).searchParams),
      param: () => params,
      header: () => headersToRecord(raw.headers),
    },
  };
}

async function invokeHono(
  wide: WideEvents,
  context: HonoContextLike,
  handler: () => Promise<Response | void> | Response | void,
): Promise<Response | void> {
  return await wide.honoMiddleware()(context, async () => await handler());
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of headers) {
    record[key] = value;
  }
  return record;
}

function urlSearchParamsToRecord(params: URLSearchParams): Record<string, string | string[]> {
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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for Hono adapter assertion");
}
