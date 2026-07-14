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

  it("ingests project events into project_events", async () => {
    const server = await createCollectorServer(
      createTestCollectorConfig({
        batchSize: 1,
        batchTimeoutMs: 10,
        duckDbPath: join(workspaceDir, "events.duckdb"),
        projects: [
          {
            projectId: "project_123",
            serviceName: "checkout",
            environment: "test",
            active: true,
            ruleVersion: "2026-07-01",
          },
        ],
      }),
    );

    try {
      const ingestResponse = await server.app.inject({
        method: "POST",
        url: "/v1/events",
        payload: {
          events: [
            {
              event_id: "event-project",
              project_id: "project_123",
              project_rule_version: "2026-07-01",
              "service.name": "checkout",
              "service.environment": "test",
              project_fields: {
                "order.total": 42,
              },
              project_field_types: {
                "order.total": "DOUBLE",
              },
            },
          ],
        },
      });

      expect(ingestResponse.statusCode).toBe(202);
      expect(ingestResponse.json()).toEqual({ accepted: 1 });

      const sqlResponse = await server.app.inject({
        method: "POST",
        url: "/sql",
        payload: {
          sql: "SELECT project_id, project_rule_version, \"service.name\", project_fields, project_field_types FROM project_events WHERE event_id = 'event-project'",
        },
      });

      expect(sqlResponse.statusCode).toBe(200);
      expect(sqlResponse.json().rows).toEqual([
        {
          project_id: "project_123",
          project_rule_version: "2026-07-01",
          "service.name": "checkout",
          project_fields: {
            "order.total": 42,
          },
          project_field_types: {
            "order.total": "DOUBLE",
          },
        },
      ]);

      const projectQueryResponse = await server.app.inject({
        method: "POST",
        url: "/query",
        payload: {
          source: "project_events",
          select: [{ fn: "SUM", field: "order.total", as: "total" }],
          filters: [{ field: "project_id", op: "eq", value: "project_123" }],
          groupBy: ["project_id"],
        },
      });

      expect(projectQueryResponse.statusCode).toBe(200);
      expect(projectQueryResponse.json().rows).toEqual([
        {
          project_id: "project_123",
          total: 42,
        },
      ]);

      const projectColumnsResponse = await server.app.inject({
        method: "GET",
        url: "/columns?source=project_events",
      });

      expect(projectColumnsResponse.statusCode).toBe(200);
      expect(projectColumnsResponse.json().columns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "project_id",
            source: "project_events",
            queryable: true,
          }),
          expect.objectContaining({
            name: "order.total",
            source: "project_events",
            storageState: "project",
            queryable: true,
          }),
        ]),
      );

      const unknownProjectFieldResponse = await server.app.inject({
        method: "POST",
        url: "/query",
        payload: {
          source: "project_events",
          select: [{ fn: "SUM", field: "missing.project_field" }],
        },
      });

      expect(unknownProjectFieldResponse.statusCode).toBe(400);
      expect(unknownProjectFieldResponse.json().error).toMatch(
        /Unknown project query field/,
      );
    } finally {
      await server.close();
    }
  });

  it("splits mixed native and project event batches across tables", async () => {
    const server = await createCollectorServer(
      createTestCollectorConfig({
        batchSize: 2,
        batchTimeoutMs: 10,
        duckDbPath: join(workspaceDir, "events.duckdb"),
        projects: [
          {
            projectId: "project_123",
            serviceName: null,
            environment: null,
            active: true,
            ruleVersion: "2026-07-01",
          },
        ],
      }),
    );

    try {
      const ingestResponse = await server.app.inject({
        method: "POST",
        url: "/v1/events",
        payload: {
          events: [
            {
              event_id: "event-default",
              correlation_id: "corr-default",
              attributes: {
                "order.total": 25,
              },
            },
            {
              event_id: "event-project",
              correlation_id: "corr-project",
              project_id: "project_123",
              project_fields: {
                "order.total": 42,
              },
              project_field_types: {
                "order.total": "DOUBLE",
              },
            },
          ],
        },
      });

      expect(ingestResponse.statusCode).toBe(202);
      expect(ingestResponse.json()).toEqual({ accepted: 2 });

      const sqlResponse = await server.app.inject({
        method: "POST",
        url: "/sql",
        payload: {
          sql: "SELECT (SELECT COUNT(*) FROM events) AS default_count, (SELECT COUNT(*) FROM project_events) AS project_count",
        },
      });

      expect(sqlResponse.statusCode).toBe(200);
      expect(sqlResponse.json().rows).toEqual([
        {
          default_count: 1,
          project_count: 1,
        },
      ]);

      const projectResponse = await server.app.inject({
        method: "POST",
        url: "/sql",
        payload: {
          sql: "SELECT project_rule_version FROM project_events WHERE event_id = 'event-project'",
        },
      });

      expect(projectResponse.statusCode).toBe(200);
      expect(projectResponse.json().rows).toEqual([
        {
          project_rule_version: "2026-07-01",
        },
      ]);
    } finally {
      await server.close();
    }
  });

  it("serves active project routing config for service and environment", async () => {
    const server = await createCollectorServer(
      createTestCollectorConfig({
        duckDbPath: join(workspaceDir, "events.duckdb"),
        projectConfigTtlSeconds: 120,
        projects: [
          {
            projectId: "project_checkout",
            serviceName: "checkout",
            environment: "prod",
            active: true,
            ruleVersion: "2026-07-01",
          },
          {
            projectId: "project_global",
            serviceName: null,
            environment: null,
            active: true,
            ruleVersion: "global-v1",
          },
          {
            projectId: "project_inactive",
            serviceName: "checkout",
            environment: "prod",
            active: false,
            ruleVersion: "inactive-v1",
          },
          {
            projectId: "project_billing",
            serviceName: "billing",
            environment: "prod",
            active: true,
            ruleVersion: "billing-v1",
          },
        ],
      }),
    );

    try {
      const response = await server.app.inject({
        method: "GET",
        url: "/v1/projects/config?serviceName=checkout&serviceEnvironment=prod",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ttl_seconds: 120,
        projects: [
          {
            project_id: "project_checkout",
            project_rule_version: "2026-07-01",
            service_name: "checkout",
            environment: "prod",
          },
          {
            project_id: "project_global",
            project_rule_version: "global-v1",
            service_name: null,
            environment: null,
          },
        ],
      });
    } finally {
      await server.close();
    }
  });

  it("rejects conflicting project routing query aliases", async () => {
    const server = await createCollectorServer(
      createTestCollectorConfig({
        duckDbPath: join(workspaceDir, "events.duckdb"),
      }),
    );

    try {
      const response = await server.app.inject({
        method: "GET",
        url: "/v1/projects/config?serviceName=checkout&service.name=billing",
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/Conflicting project routing/);
    } finally {
      await server.close();
    }
  });

  it("rejects project events with unknown project IDs", async () => {
    const server = await createCollectorServer(
      createTestCollectorConfig({
        batchSize: 1,
        batchTimeoutMs: 10,
        duckDbPath: join(workspaceDir, "events.duckdb"),
      }),
    );

    try {
      const response = await server.app.inject({
        method: "POST",
        url: "/v1/events",
        payload: {
          events: [
            {
              event_id: "event-project",
              project_id: "project_missing",
              project_fields: {
                "order.total": 42,
              },
              project_field_types: {
                "order.total": "DOUBLE",
              },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/Unknown project_id "project_missing"/);
    } finally {
      await server.close();
    }
  });

  it("rejects project events for inactive projects", async () => {
    const server = await createCollectorServer(
      createTestCollectorConfig({
        batchSize: 1,
        batchTimeoutMs: 10,
        duckDbPath: join(workspaceDir, "events.duckdb"),
        projects: [
          {
            projectId: "project_123",
            serviceName: null,
            environment: null,
            active: false,
            ruleVersion: "2026-07-01",
          },
        ],
      }),
    );

    try {
      const response = await server.app.inject({
        method: "POST",
        url: "/v1/events",
        payload: {
          events: [
            {
              event_id: "event-project",
              project_id: "project_123",
              project_fields: {
                "order.total": 42,
              },
              project_field_types: {
                "order.total": "DOUBLE",
              },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/Project "project_123" is not active/);
    } finally {
      await server.close();
    }
  });

  it("rejects project events outside the configured service scope", async () => {
    const server = await createCollectorServer(
      createTestCollectorConfig({
        batchSize: 1,
        batchTimeoutMs: 10,
        duckDbPath: join(workspaceDir, "events.duckdb"),
        projects: [
          {
            projectId: "project_123",
            serviceName: "checkout",
            environment: "prod",
            active: true,
            ruleVersion: "2026-07-01",
          },
        ],
      }),
    );

    try {
      const response = await server.app.inject({
        method: "POST",
        url: "/v1/events",
        payload: {
          events: [
            {
              event_id: "event-project",
              project_id: "project_123",
              "service.name": "billing",
              "service.environment": "prod",
              project_fields: {
                "order.total": 42,
              },
              project_field_types: {
                "order.total": "DOUBLE",
              },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/does not match service.name/);
    } finally {
      await server.close();
    }
  });

  it("returns 400 for malformed project event metadata", async () => {
    const server = await createCollectorServer(
      createTestCollectorConfig({
        duckDbPath: join(workspaceDir, "events.duckdb"),
      }),
    );

    try {
      const response = await server.app.inject({
        method: "POST",
        url: "/v1/events",
        payload: {
          events: [
            {
              event_id: "event-project",
              project_id: "project_123",
              project_fields: {
                "order.total": "42",
              },
              project_field_types: {
                "order.total": "DOUBLE",
              },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/does not match declared type DOUBLE/);
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
    projectConfigTtlSeconds: 60,
    projects: [],
    ...overrides,
  };
}
