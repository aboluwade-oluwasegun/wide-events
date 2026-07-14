import { EventEmitter } from "node:events";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { describe, expect, it, vi } from "vitest";
import { WideEvents } from "./index";

class FakeResponse extends EventEmitter {
  statusCode = 200;

  override once(event: "finish", listener: () => void): this {
    return super.once(event, listener);
  }
}

describe("WideEvents node SDK", () => {
  it("exports a request event from middleware", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 202 }));
    const wide = new WideEvents({
      serviceName: "payments",
      collectorUrl: "http://collector.test",
      fetchImpl,
      batchSize: 1,
    });
    const response = new FakeResponse();

    wide.middleware()({ method: "GET", url: "/checkout" }, response, () => {
      wide.annotate({ "user.id": "user-1" });
    });
    response.emit("finish");

    await wide.forceFlush();

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://collector.test/v1/events",
      expect.objectContaining({ method: "POST" }),
    );
    expect(body.events[0]).toEqual(
      expect.objectContaining({
        "service.name": "payments",
        "http.route": "/checkout",
        "http.status_code": 200,
        "user.id": "user-1",
      }),
    );
  });

  it("marks 500 responses as errors automatically", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 202 }));
    const wide = new WideEvents({
      serviceName: "payments",
      collectorUrl: "http://collector.test",
      fetchImpl,
      batchSize: 1,
    });
    const response = new FakeResponse();
    response.statusCode = 503;

    wide.middleware()({ method: "GET", url: "/checkout" }, response, () => {});
    response.emit("finish");
    await wide.forceFlush();

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.events[0]).toEqual(
      expect.objectContaining({
        error: true,
        "exception.slug": "http_503",
      }),
    );
  });

  it("keeps queued events for retry when collector flush fails", async () => {
    const failedExport = createDeferred<Response>();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(failedExport.promise)
      .mockResolvedValueOnce(new Response("", { status: 202 }));
    const wide = new WideEvents({
      serviceName: "payments",
      collectorUrl: "http://collector.test",
      fetchImpl,
      batchSize: 100,
    });
    const response = new FakeResponse();

    wide.middleware()({ method: "GET", url: "/checkout" }, response, () => {
      wide.annotate({ "user.id": "user-1" });
    });
    response.emit("finish");

    const failedFlush = expect(wide.forceFlush()).rejects.toThrow("offline");
    failedExport.reject(new Error("offline"));
    await failedFlush;
    await wide.forceFlush();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const failedBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    const retriedBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(retriedBody.events[0]).toEqual(
      expect.objectContaining({
        event_id: failedBody.events[0].event_id,
        "http.route": "/checkout",
        "user.id": "user-1",
      }),
    );
  });

  it("exports ordinary events when project activation config is missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 202 }));
    const wide = new WideEvents({
      serviceName: "payments",
      collectorUrl: "http://collector.test",
      fetchImpl,
      batchSize: 1,
      projects: {
        ids: ["project_checkout"],
      },
    });
    const handler = wide.wrapHandler(async () => {
      wide.annotate({ "user.id": "user-1" });
      return { statusCode: 200, body: "ok" };
    });

    await handler(
      {
        rawPath: "/checkout",
        requestContext: { http: { method: "POST" } },
      },
      {},
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://collector.test/v1/events");
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.events[0]).toEqual(
      expect.objectContaining({
        "user.id": "user-1",
      }),
    );
    expect(body.events[0]).not.toHaveProperty("project_id");
  });

  it("records thrown lambda errors automatically", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 202 }));
    const wide = new WideEvents({
      serviceName: "lambda",
      collectorUrl: "http://collector.test",
      fetchImpl,
      batchSize: 1,
    });
    const handler = wide.wrapHandler(async () => {
      throw new Error("boom");
    });

    await expect(handler({}, {})).rejects.toThrow("boom");

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.events[0]).toEqual(
      expect.objectContaining({
        error: true,
        "exception.slug": "Error",
        attributes: expect.objectContaining({
          "exception.message": "boom",
          "exception.handled": false,
        }),
      }),
    );
  });

  it("does not expose manual project annotation", () => {
    const wide = new WideEvents({ serviceName: "payments" });
    const methodName = ["annotate", "Project"].join("");

    expect(methodName in wide).toBe(false);
  });

  it("ignores project metadata passed through the generic run boundary", () => {
    const wide = new WideEvents({ serviceName: "payments" });
    let current: ReturnType<WideEvents["current"]>;

    wide.run(
      {
        project_id: "project_manual",
        project_rule_version: "rules-v1",
        project_fields: {
          "order.total": 42.5,
        },
        project_field_types: {
          "order.total": "DOUBLE",
        },
      },
      () => {
        current = wide.current();
      },
    );

    expect(current).not.toEqual(
      expect.objectContaining({
        project_id: "project_manual",
      }),
    );
  });

  it("discovers project extraction rules without middleware wiring", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          rulesUrl: "https://cdn.example.com/wide-events/rules.json",
          projects: [
            {
              project_id: "project_checkout",
              rule_version: "rules-v1",
              rules: {
                routes: [
                  {
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
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const wide = new WideEvents({
      serviceName: "payments",
      apiKey: "we_key_123",
      apiUrl: "https://api.example.com",
      projects: {
        ids: ["project_checkout"],
        refreshIntervalMs: 30_000,
      },
      fetchImpl,
    });

    await expect(wide.getProjectRules()).resolves.toEqual([
      expect.objectContaining({
        project_id: "project_checkout",
        project_rule_version: "rules-v1",
      }),
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.com/v1/sdk/projects/discover",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      projectIds: ["project_checkout"],
    });
  });

  it("records fetch failures automatically", async () => {
    const wide = new WideEvents({ serviceName: "payments" });
    const wrapped = wide.wrapFetch(vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));

    await wide.run({}, async () => {
      await expect(wrapped("http://api.test/orders")).rejects.toThrow("offline");
      expect(wide.current()?.attributes).toEqual(
        expect.objectContaining({
          "http.client.errors": [
            expect.objectContaining({
              host: "api.test",
              error: "offline",
            }),
          ],
          "exception.message": "offline",
        }),
      );
    });
  });

  it("supports constructor-driven fetch instrumentation", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 200 }));
    globalThis.fetch = fetchMock;

    const wide = new WideEvents({ serviceName: "payments" }, { fetch: true });

    try {
      await wide.run({}, async () => {
        await fetch("http://api.test/checkout", { method: "POST" });
        expect(wide.current()?.attributes).toEqual(
          expect.objectContaining({
            "http.client.requests": [
              expect.objectContaining({
                host: "api.test",
                path: "/checkout",
                status_code: 200,
              }),
            ],
          }),
        );
      });
    } finally {
      await wide.shutdown();
      globalThis.fetch = originalFetch;
    }
  });

  it("supports constructor-driven pg instrumentation", async () => {
    const pool = {
      query: vi.fn(async () => ({ rowCount: 1 })),
    } as unknown as Pool;

    const wide = new WideEvents({ serviceName: "payments" }, { pg: [pool] });

    await wide.run({}, async () => {
      await pool.query("SELECT 1");
      expect(wide.current()?.attributes).toEqual(
        expect.objectContaining({
          "db.queries": [
            expect.objectContaining({
              row_count: 1,
            }),
          ],
        }),
      );
    });
  });

  it("supports constructor-driven redis instrumentation", async () => {
    const redis = new EventEmitter() as unknown as Redis;
    const wide = new WideEvents({ serviceName: "payments" }, { redis: [redis] });

    await wide.run({}, async () => {
      redis.emit("command", { commandId: "1", name: "get", args: ["session:1"] });
      redis.emit("reply", { commandId: "1", name: "get", args: ["session:1"] });

      expect(wide.current()?.attributes).toEqual(
        expect.objectContaining({
          "redis.commands": [
            expect.objectContaining({
              command: "GET",
              key: "session:1",
            }),
          ],
        }),
      );
    });
  });

  it("supports constructor-driven aws instrumentation", async () => {
    let captured:
      | ((next: (args: { input: unknown }) => Promise<{ output: unknown }>, context: { commandName: string }) => (args: { input: unknown }) => Promise<{ output: unknown }>)
      | undefined;

    const awsClient = {
      config: { serviceId: "DynamoDB" },
      middlewareStack: {
        add: (middleware: typeof captured extends undefined ? never : NonNullable<typeof captured>) => {
          captured = middleware;
        },
      },
    };

    const wide = new WideEvents({ serviceName: "payments" }, { aws: [awsClient] });

    await wide.run({}, async () => {
      await captured?.(
        async () => ({ output: { ConsumedCapacity: { CapacityUnits: 2 } } }),
        { commandName: "QueryCommand" },
      )({ input: { TableName: "orders" } });

      expect(wide.current()?.attributes).toEqual(
        expect.objectContaining({
          "aws.client.operations": [
            expect.objectContaining({
              operation: "QueryCommand",
              service_id: "DynamoDB",
              table: "orders",
            }),
          ],
        }),
      );
    });
  });
});

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });

  return { promise, resolve, reject };
}
