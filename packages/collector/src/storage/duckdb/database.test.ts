import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDbDatabase } from "./database";

describe("DuckDbDatabase", () => {
  let database: DuckDbDatabase;
  let workspaceDir = "";

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), "wide-events-database-"));
    database = await DuckDbDatabase.create(join(workspaceDir, "events.duckdb"));
  });

  afterEach(async () => {
    database.close();
    await rm(workspaceDir, { recursive: true, force: true });
  });

  it("normalizes bigint, timestamp, and complex DuckDB values", async () => {
    const rows = await database.executeRead(
      "SELECT 42::BIGINT AS safe_bigint, 9007199254740993::BIGINT AS unsafe_bigint, TIMESTAMPTZ '2024-01-01T00:00:00Z' AS ts, [1, 2, 3] AS payload",
    );

    expect(rows[0]?.["safe_bigint"]).toBe(42);
    expect(rows[0]?.["unsafe_bigint"]).toBe("9007199254740993");
    expect(rows[0]?.["ts"]).toBe("2024-01-01T00:00:00.000Z");
    expect(rows[0]?.["payload"]).toEqual([1, 2, 3]);
  });

  it("inserts project event rows into project_events", async () => {
    await database.insertProjectEventRows(
      [
        "correlation_id",
        "event_id",
        "main",
        "project_field_types",
        "project_fields",
        "project_id",
        "project_rule_version",
        "sample_rate",
        "ts",
      ],
      [
        {
          correlation_id: "corr-project",
          event_id: "event-project",
          main: true,
          project_field_types: {
            "order.total": "DOUBLE",
          },
          project_fields: {
            "order.total": 42.5,
          },
          project_id: "project_123",
          project_rule_version: "2026-07-01",
          sample_rate: 1,
          ts: "2024-01-01T00:00:00.000Z",
        },
      ],
    );

    const rows = await database.executeRead(
      "SELECT project_id, project_rule_version, project_fields, project_field_types FROM project_events WHERE event_id = ?",
      ["event-project"],
    );

    expect(rows).toEqual([
      {
        project_id: "project_123",
        project_rule_version: "2026-07-01",
        project_fields: {
          "order.total": 42.5,
        },
        project_field_types: {
          "order.total": "DOUBLE",
        },
      },
    ]);
  });
});
