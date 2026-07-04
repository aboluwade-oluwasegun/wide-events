import { EventEmitter } from "node:events";
import type { WideEvent } from "@wide-events/internal";
import { describe, expect, it, vi } from "vitest";
import { WideEvents, type ExpressRequestLike, type ExpressResponseLike } from "./index";

class FakeExpressResponse extends EventEmitter implements ExpressResponseLike {
  statusCode = 200;
  sentBody: unknown;

  json(body: unknown): this {
    this.sentBody = body;
    this.emit("finish");
    return this;
  }

  send(body?: unknown): this {
    this.sentBody = body;
    this.emit("finish");
    return this;
  }

  override once(event: "finish", listener: () => void): this {
    return super.once(event, listener);
  }
}

describe("WideEvents Express adapter", () => {
  it("emits project metadata from matching request rules", async () => {
    const exportedEvents: WideEvent[] = [];
    const wide = createExpressWideEvents(exportedEvents, {
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
    const response = new FakeExpressResponse();

    await invokeExpress(wide, {
      method: "POST",
      url: "/checkout",
      path: "/checkout",
      body: {
        cart: {
          itemCount: 2,
        },
      },
    }, response, () => {
      response.send("ok");
    });

    await waitFor(() => exportedEvents.length === 1);
    expect(exportedEvents[0]).toEqual(
      expect.objectContaining({
        project_id: "project_checkout",
        project_rule_version: "rules-v1",
        project_fields: {
          "cart.item_count": 2,
        },
        project_field_types: {
          "cart.item_count": "BIGINT",
        },
      }),
    );
  });

  it("extracts project fields from Express response bodies", async () => {
    const exportedEvents: WideEvent[] = [];
    const wide = createExpressWideEvents(exportedEvents, {
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
    const response = new FakeExpressResponse();
    response.statusCode = 201;

    await invokeExpress(wide, {
      method: "POST",
      originalUrl: "/checkout?coupon=SUMMER",
      path: "/checkout",
    }, response, () => {
      response.json({ total: 42.5 });
    });

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

  it("leaves unmatched Express requests as normal events", async () => {
    const exportedEvents: WideEvent[] = [];
    const wide = createExpressWideEvents(exportedEvents, {
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
    const response = new FakeExpressResponse();

    await invokeExpress(wide, {
      method: "GET",
      originalUrl: "/health",
      path: "/health",
    }, response, () => {
      response.send("ok");
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

function createExpressWideEvents(
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

async function invokeExpress(
  wide: WideEvents,
  request: ExpressRequestLike,
  response: FakeExpressResponse,
  handler: () => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    wide.expressMiddleware()(request, response, (error?: unknown) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      handler();
      resolve();
    });
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for Express adapter assertion");
}
