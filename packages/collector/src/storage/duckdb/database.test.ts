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
});
