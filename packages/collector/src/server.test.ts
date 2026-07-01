import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CollectorConfig } from "./config";
import { createCollectorServer } from "./server";

describe("collector server", () => {
  let workspaceDir = "";

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), "wide-events-collector-"));
  });

  afterEach(async () => {
    if (workspaceDir) {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("ingests native events and serves query and event results", async () => {
    const server = await createCollectorServer(
      createTestCollectorConfig({
        duckDbPath: join(workspaceDir, "events.duckdb"),
        batchSize: 10,
        batchTimeoutMs: 10,
      }),
    );

    try {
      const ingestResponse = await server.app.inject({
        method: "POST",
        url: "/v1/events",
        payload: {
          events: [
            {
              event_id: "event-1",
              correlation_id: "corr-1",
              ts: "2024-01-01T00:00:00.000Z",
              duration_ms: 100,
              main: true,
              "service.name": "payments",
              "http.route": "/pay",
              attributes: {
                "order.total": 42,
                "db.queries": [{ operation: "select_order", duration_ms: 12 }],
              },
              promote: ["order.total"],
            },
            {
              event_id: "event-2",
              correlation_id: "corr-1",
              parent_event_id: "event-1",
              ts: "2024-01-01T00:00:01.000Z",
              main: false,
              "service.name": "payments",
              attributes: {
                "db.statement": "select 1",
              },
            },
          ],
        },
      });

      expect(ingestResponse.statusCode).toBe(202);

      const allResponse = await server.app.inject({
        method: "POST",
        url: "/query",
        payload: {
          select: [{ fn: "COUNT", as: "total" }],
          filters: [{ field: "correlation_id", op: "eq", value: "corr-1" }],
          scope: "all",
        },
      });

      expect(allResponse.statusCode).toBe(200);
      expect(allResponse.json().rows[0]?.["total"]).toBe(2);

      const mainResponse = await server.app.inject({
        method: "POST",
        url: "/query",
        payload: {
          select: [{ fn: "COUNT", as: "total" }],
          filters: [{ field: "correlation_id", op: "eq", value: "corr-1" }],
        },
      });

      expect(mainResponse.statusCode).toBe(200);
      expect(mainResponse.json().rows[0]?.["total"]).toBe(1);

      const eventsResponse = await server.app.inject({
        method: "GET",
        url: "/events/corr-1",
      });

      expect(eventsResponse.statusCode).toBe(200);
      expect(eventsResponse.json().rows).toHaveLength(2);

      const promotedResponse = await server.app.inject({
        method: "POST",
        url: "/query",
        payload: {
          select: [{ fn: "SUM", field: "order.total", as: "total" }],
        },
      });

      expect(promotedResponse.statusCode).toBe(200);
      expect(promotedResponse.json().rows[0]?.["total"]).toBe(42);
    } finally {
      await server.close();
    }
  });

  it("returns 400 for malformed event payloads", async () => {
    const server = await createCollectorServer(
      createTestCollectorConfig({
        duckDbPath: join(workspaceDir, "events.duckdb"),
      }),
    );

    try {
      const response = await server.app.inject({
        method: "POST",
        url: "/v1/events",
        payload: { events: [] },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/events/);
    } finally {
      await server.close();
    }
  });

  it("rejects mutating sql requests", async () => {
    const server = await createCollectorServer(
      createTestCollectorConfig({
        duckDbPath: join(workspaceDir, "events.duckdb"),
      }),
    );

    try {
      const response = await server.app.inject({
        method: "POST",
        url: "/sql",
        payload: { sql: "DELETE FROM events" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/read-only/);
    } finally {
      await server.close();
    }
  });

  it("returns 503 when the ingest queue is saturated", async () => {
    const server = await createCollectorServer(
      createTestCollectorConfig({
        duckDbPath: join(workspaceDir, "events.duckdb"),
        batchSize: 10,
        batchTimeoutMs: 5_000,
        queueLimit: 1,
      }),
    );

    try {
      const firstRequest = server.app.inject({
        method: "POST",
        url: "/v1/events",
        payload: {
          events: [{ event_id: "event-1", correlation_id: "corr-1" }],
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 25));

      const secondResponse = await server.app.inject({
        method: "POST",
        url: "/v1/events",
        payload: {
          events: [{ event_id: "event-2", correlation_id: "corr-2" }],
        },
      });

      expect(secondResponse.statusCode).toBe(503);
      await server.dependencies.store.flush();
      expect((await firstRequest).statusCode).toBe(202);
    } finally {
      await server.close();
    }
  });
});

function createTestCollectorConfig(
  overrides: Partial<Extract<CollectorConfig, { storage: "duckdb" }>>,
): Extract<CollectorConfig, { storage: "duckdb" }> {
  return {
    storage: "duckdb",
    duckDbPath: "unused",
    port: 4318,
    batchSize: 100,
    batchTimeoutMs: 1_000,
    retentionDays: 30,
    maxPromotedColumns: 200,
    promotionIntervalMs: 300_000,
    promotionMinRows: 1_000,
    promotionMinRatio: 0.01,
    promotionMaxKeysPerRun: 25,
    queueLimit: 10_000,
    ...overrides,
  };
}
