import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectorConfig } from "../config";
import { duckDbQuerySqlDialect } from "../query/dialect";
import { createCollectorDatabase } from "./backend";
import { ClickHouseDatabase } from "./clickhouse";
import type { CollectorDatabase } from "./types";

describe("createCollectorDatabase", () => {
  let workspaceDir = "";

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), "wide-events-backend-"));
  });

  afterEach(async () => {
    if (workspaceDir) {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("creates the DuckDB backend", async () => {
    const database = await createCollectorDatabase(
      createDuckDbConfig({
        duckDbPath: join(workspaceDir, "events.duckdb")
      })
    );

    try {
      await expect(database.countEvents()).resolves.toBe(0);
    } finally {
      await database.close();
    }
  });

  it("creates the ClickHouse backend when configured", async () => {
    const database = createMockDatabase();
    const create = vi
      .spyOn(ClickHouseDatabase, "create")
      .mockResolvedValue(database as ClickHouseDatabase);

    try {
      await expect(createCollectorDatabase(createClickHouseConfig())).resolves.toBe(
        database
      );
      expect(create).toHaveBeenCalledWith(createClickHouseConfig());
    } finally {
      create.mockRestore();
    }
  });
});

function createMockDatabase(): CollectorDatabase {
  return {
    queryDialect: duckDbQuerySqlDialect,
    async executeRead() {
      return [];
    },
    async readColumns() {
      return [];
    },
    async addPromotedColumn() {},
    async backfillPromotedColumn() {},
    async insertEventRows() {},
    async insertProjectEventRows() {},
    async loadAttributeCatalog() {
      return [];
    },
    async saveAttributeCatalogEntry() {},
    async deleteEventsBefore() {},
    async runRetentionMaintenance() {},
    async countEvents() {
      return 0;
    },
    close() {}
  };
}

function createDuckDbConfig(
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
    promotionMaxKeysPerRun: 1,
    queueLimit: 10_000,
    projectConfigTtlSeconds: 60,
    projects: [],
    ...overrides
  };
}

function createClickHouseConfig(): CollectorConfig {
  return {
    storage: "clickhouse",
    clickHouse: {
      url: "http://localhost:8123",
      database: "wide_events",
      username: "default"
    },
    port: 4318,
    batchSize: 100,
    batchTimeoutMs: 1_000,
    retentionDays: 30,
    maxPromotedColumns: 200,
    promotionIntervalMs: 300_000,
    promotionMinRows: 1_000,
    promotionMinRatio: 0.01,
    promotionMaxKeysPerRun: 1,
    queueLimit: 10_000,
    projectConfigTtlSeconds: 60,
    projects: []
  };
}
