import { describe, expect, it, vi } from "vitest";
import { WideEvents } from "./index";

describe("WideEvents edge SDK", () => {
  it("exports request events through waitUntil", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 202 }));
    const wide = new WideEvents({
      serviceName: "worker",
      collectorUrl: "http://collector.test",
      fetchImpl,
      batchSize: 1,
    });
    const promises: Promise<unknown>[] = [];

    const response = await wide.fetchHandler(
      new Request("http://example.test/worker", { method: "POST" }),
      {
        waitUntil(promise) {
          promises.push(promise);
        },
      },
      () => new Response("ok", { status: 201 }),
    );

    expect(response.status).toBe(201);
    await Promise.all(promises);

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.events[0]).toEqual(
      expect.objectContaining({
        "service.name": "worker",
        "http.route": "/worker",
        "http.request.method": "POST",
        "http.status_code": 201,
      }),
    );
  });

  it("records thrown handler errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 202 }));
    const wide = new WideEvents({
      serviceName: "worker",
      collectorUrl: "http://collector.test",
      fetchImpl,
      batchSize: 1,
    });
    const promises: Promise<unknown>[] = [];

    await expect(
      wide.fetchHandler(
        new Request("http://example.test/worker"),
        {
          waitUntil(promise) {
            promises.push(promise);
          },
        },
        () => {
          throw new Error("edge failed");
        },
      ),
    ).rejects.toThrow("edge failed");
    await Promise.all(promises);

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.events[0]).toEqual(
      expect.objectContaining({
        error: true,
        attributes: expect.objectContaining({
          "exception.message": "edge failed",
        }),
      }),
    );
  });

  it("exports project events from edge handlers", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(createDiscoveryResponse("project_worker", "rules-v1")))
      .mockResolvedValueOnce(new Response("", { status: 202 }));
    const wide = new WideEvents({
      serviceName: "worker",
      environment: "prod",
      collectorUrl: "http://collector.test",
      fetchImpl,
      batchSize: 100,
      apiKey: "we_key_123",
      apiUrl: "https://api.example.com",
      projects: {
        ids: ["project_worker"],
      },
    });
    const promises: Promise<unknown>[] = [];

    const response = await wide.fetchHandler(
      new Request("http://example.test/checkout", { method: "POST" }),
      {
        waitUntil(promise) {
          promises.push(promise);
        },
      },
      () => {
        wide.annotateProject({
          "checkout.converted": true,
        });
        return new Response("ok", { status: 201 });
      },
    );

    expect(response.status).toBe(201);
    await Promise.all(promises);

    const body = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(body.events[0]).toEqual(
      expect.objectContaining({
        project_id: "project_worker",
        project_rule_version: "rules-v1",
        "service.name": "worker",
        "service.environment": "prod",
        "http.route": "/checkout",
        "http.status_code": 201,
        project_fields: {
          "checkout.converted": true,
        },
        project_field_types: {
          "checkout.converted": "BOOLEAN",
        },
      }),
    );
  });
});

function createDiscoveryResponse(projectId: string, ruleVersion: string): unknown {
  return {
    rulesUrl: "https://cdn.example.com/wide-events/rules.json",
    projects: [
      {
        project_id: projectId,
        rule_version: ruleVersion,
        rules: {
          routes: [
            {
              match: {
                method: "POST",
                path: "/checkout",
              },
              fields: [
                {
                  field: "checkout.converted",
                  source: "request.body",
                  path: "converted",
                  type: "BOOLEAN",
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
