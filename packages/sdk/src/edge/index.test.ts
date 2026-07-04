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
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 202 }));
    const wide = new WideEvents({
      serviceName: "worker",
      environment: "prod",
      collectorUrl: "http://collector.test",
      fetchImpl,
      batchSize: 1,
      projects: ["project_worker"],
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

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.events[0]).toEqual(
      expect.objectContaining({
        project_id: "project_worker",
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
