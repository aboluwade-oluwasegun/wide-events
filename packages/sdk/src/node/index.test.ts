import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { WideEvents } from "./index";

class FakeResponse extends EventEmitter {
  statusCode = 200;

  once(event: "finish", listener: () => void): this {
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
});
