import { describe, expect, it, vi } from "vitest";
import { WideEventsClient } from "./index";

describe("WideEventsClient", () => {
  it("posts structured queries and parses the response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ rows: [{ total: 3 }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const client = new WideEventsClient({
      url: "http://collector.test",
      fetchImpl
    });

    const result = await client.query({
      select: [{ fn: "COUNT", as: "total" }]
    });

    expect(result.rows[0]?.["total"]).toBe(3);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://collector.test/query",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("surfaces collector errors with the response payload message", async () => {
    const client = new WideEventsClient({
      url: "http://collector.test",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: "Only read-only SQL statements are allowed" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        })
      )
    });

    await expect(client.sql("DELETE FROM events")).rejects.toThrow(/read-only/);
  });

  it("fetches events by correlation id", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ correlationId: "corr-1", rows: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const client = new WideEventsClient({
      url: "http://collector.test",
      fetchImpl
    });

    await expect(client.getEvents("corr-1")).resolves.toEqual({
      correlationId: "corr-1",
      rows: []
    });
    expect(fetchImpl).toHaveBeenCalledWith("http://collector.test/events/corr-1");
  });

  it("surfaces plain-text collector errors", async () => {
    const client = new WideEventsClient({
      url: "http://collector.test",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("collector exploded", {
          status: 500,
          headers: { "content-type": "text/plain" }
        })
      )
    });

    await expect(client.sql("SELECT 1")).rejects.toThrow("collector exploded");
  });

  it("falls back to the HTTP status when an error response body is empty", async () => {
    const client = new WideEventsClient({
      url: "http://collector.test",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("", {
          status: 503
        })
      )
    });

    await expect(client.sql("SELECT 1")).rejects.toThrow("HTTP 503");
  });
});
