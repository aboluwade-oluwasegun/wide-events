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
    await wide.getProjectRules();
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
    await wide.getProjectRules();
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
    await wide.getProjectRules();
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

  it("leaves Express requests as normal events when project discovery is unauthorized", async () => {
    const exportedEvents: WideEvent[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("invalid token", { status: 401 }));
    const wide = createExpressWideEvents(exportedEvents, {
      version: 1,
      rules: [],
    }, fetchImpl);
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
        "http.route": "/checkout",
        "http.status_code": 200,
      }),
    );
    expect(exportedEvents[0]?.project_id).toBeUndefined();
    expect(exportedEvents[0]?.project_fields).toBeUndefined();
    expect(exportedEvents[0]?.project_field_types).toBeUndefined();
  });

  it("starts project discovery without blocking cold-cache Express requests", async () => {
    const exportedEvents: WideEvent[] = [];
    const discovery = createDeferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>().mockReturnValue(discovery.promise);
    const rulesDocument = {
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
    };
    const wide = createExpressWideEvents(exportedEvents, rulesDocument, fetchImpl);
    const response = new FakeExpressResponse();
    let handlerCalled = false;

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
      handlerCalled = true;
      response.send("ok");
    });

    expect(handlerCalled).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await waitFor(() => exportedEvents.length === 1);
    expect(exportedEvents[0]?.project_id).toBeUndefined();
    expect(exportedEvents[0]?.project_fields).toBeUndefined();

    discovery.resolve(
      new Response(JSON.stringify(createProjectDiscoveryResponse(rulesDocument)), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(wide.getProjectRules()).resolves.toEqual([
      expect.objectContaining({
        project_id: "project_checkout",
        project_rule_version: "rules-v1",
      }),
    ]);
  });
});

function createExpressWideEvents(
  exportedEvents: WideEvent[],
  rulesDocument: unknown,
  fetchImpl: typeof fetch = createProjectDiscoveryFetch(rulesDocument),
): WideEvents {
  return new WideEvents({
    serviceName: "checkout-api",
    environment: "prod",
    apiKey: "we_key_123",
    apiUrl: "https://api.example.com",
    projects: {
      ids: ["project_checkout"],
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

function createProjectDiscoveryFetch(rulesDocument: unknown): typeof fetch {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(createProjectDiscoveryResponse(rulesDocument)), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function createProjectDiscoveryResponse(rulesDocument: unknown): unknown {
  const routesByProject = new Map<
    string,
    {
      rule_version: string;
      routes: Array<{ match: unknown; fields: unknown }>;
    }
  >();
  const rules = isRecord(rulesDocument) && Array.isArray(rulesDocument["rules"])
    ? rulesDocument["rules"]
    : [];

  for (const rule of rules) {
    if (!isRecord(rule)) {
      continue;
    }

    const projectId = String(rule["project_id"] ?? "");
    const ruleVersion = String(rule["project_rule_version"] ?? "");
    if (!projectId || !ruleVersion) {
      continue;
    }

    const project = routesByProject.get(projectId) ?? {
      rule_version: ruleVersion,
      routes: [],
    };
    project.routes.push({
      match: rule["match"],
      fields: rule["fields"],
    });
    routesByProject.set(projectId, project);
  }

  return {
    rulesUrl: "https://cdn.example.com/wide-events/rules.json",
    projects: [...routesByProject.entries()].map(([project_id, project]) => ({
      project_id,
      rule_version: project.rule_version,
      rules: {
        routes: project.routes,
      },
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
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
