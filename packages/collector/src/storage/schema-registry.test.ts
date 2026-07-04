import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDbDatabase } from "./duckdb";
import { ProjectSchemaRegistry } from "./project-schema-registry";
import { SchemaRegistry } from "./schema-registry";

describe("SchemaRegistry", () => {
  let database: DuckDbDatabase;
  let workspaceDir = "";

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), "wide-events-schema-"));
    database = await DuckDbDatabase.create(join(workspaceDir, "events.duckdb"));
  });

  afterEach(async () => {
    database.close();
    await rm(workspaceDir, { recursive: true, force: true });
  });

  it("adds promoted columns up to the configured cap", async () => {
    const registry = new SchemaRegistry(1);
    await registry.hydrate(database);

    expect(await registry.ensurePromotedColumn(database, "custom.one", "VARCHAR")).toBe(
      true
    );
    expect(await registry.ensurePromotedColumn(database, "custom.two", "VARCHAR")).toBe(
      false
    );
    expect(registry.isKnownColumn("custom.one")).toBe(true);
    expect(registry.isKnownColumn("custom.two")).toBe(false);

    const tableInfo = await database.readColumns("events");
    expect(tableInfo.some((row) => row["name"] === "custom.one")).toBe(true);
    expect(tableInfo.some((row) => row["name"] === "custom.two")).toBe(false);
  });

  it("adds typed project columns and rejects type conflicts", async () => {
    const registry = new ProjectSchemaRegistry();
    await registry.hydrate(database);

    await registry.ensureProjectColumns(database, [
      {
        correlation_id: "corr-project",
        event_id: "event-project",
        parent_event_id: null,
        ts: "2024-01-01T00:00:00.000Z",
        duration_ms: 10,
        main: true,
        sample_rate: 1,
        "service.name": "checkout",
        "service.environment": "test",
        "service.version": null,
        "http.route": "/checkout",
        "http.status_code": 200,
        "http.request.method": "POST",
        error: false,
        "exception.slug": null,
        "user.id": null,
        "user.type": null,
        "user.org.id": null,
        project_id: "project_123",
        project_rule_version: "rules-v1",
        project_fields: {
          "order.total": 42.5,
        },
        project_field_types: {
          "order.total": "DOUBLE",
        },
      },
    ]);

    expect(registry.isQueryableColumn("order.total")).toBe(true);
    expect(await database.readColumns("project_events")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "order.total",
        }),
      ]),
    );

    await expect(
      registry.ensureProjectColumns(database, [
        {
          correlation_id: "corr-project",
          event_id: "event-project",
          parent_event_id: null,
          ts: "2024-01-01T00:00:00.000Z",
          duration_ms: 10,
          main: true,
          sample_rate: 1,
          "service.name": "checkout",
          "service.environment": "test",
          "service.version": null,
          "http.route": "/checkout",
          "http.status_code": 200,
          "http.request.method": "POST",
          error: false,
          "exception.slug": null,
          "user.id": null,
          "user.type": null,
          "user.org.id": null,
          project_id: "project_123",
          project_rule_version: "rules-v1",
          project_fields: {
            "order.total": "42.5",
          },
          project_field_types: {
            "order.total": "VARCHAR",
          },
        },
      ]),
    ).rejects.toThrow(/incompatible type/);
  });
});
