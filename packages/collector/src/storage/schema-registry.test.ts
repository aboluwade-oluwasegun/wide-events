import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDbDatabase } from "./duckdb";
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
});
