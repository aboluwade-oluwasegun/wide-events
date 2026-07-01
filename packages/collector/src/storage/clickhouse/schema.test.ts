import { describe, expect, it, vi } from "vitest";
import type { CollectorConfig } from "../../config";
import { toClickHouseClientOptions } from "./client";
import {
  buildClickHouseSchemaStatements,
  initializeClickHouseSchema,
  toClickHouseColumnType,
} from "./schema";

describe("ClickHouse schema and client config", () => {
  it("maps collector config to ClickHouse client options", () => {
    expect(toClickHouseClientOptions(createClickHouseConfig())).toEqual({
      url: "http://localhost:8123",
      database: "wide_events",
      username: "analytics",
      password: "secret",
      application: "wide-events-collector",
    });
  });

  it("builds ClickHouse schema statements for events and the attribute catalog", () => {
    const statements = buildClickHouseSchemaStatements("wide_events");

    expect(statements.map((statement) => statement.label)).toEqual([
      "database",
      "events table",
      "attribute catalog table",
    ]);
    expect(statements[0]?.query).toBe(
      "CREATE DATABASE IF NOT EXISTS `wide_events`",
    );

    const eventsTable = statements[1]?.query ?? "";
    expect(eventsTable).toContain(
      "CREATE TABLE IF NOT EXISTS `wide_events`.`events`",
    );
    expect(eventsTable).toContain("`event_id` String");
    expect(eventsTable).toContain("`parent_event_id` Nullable(String)");
    expect(eventsTable).toContain("`ts` DateTime64(3, 'UTC')");
    expect(eventsTable).toContain("`duration_ms` Nullable(Float64)");
    expect(eventsTable).toContain("`main` Bool DEFAULT false");
    expect(eventsTable).toContain("`sample_rate` Int32 DEFAULT 1");
    expect(eventsTable).toContain(
      "`attributes_overflow` Map(String, String) DEFAULT map()",
    );
    expect(eventsTable).toContain("ENGINE = MergeTree");
    expect(eventsTable).toContain(
      "ORDER BY (`ts`, `service.name`, `correlation_id`, `event_id`)",
    );

    const catalogTable = statements[2]?.query ?? "";
    expect(catalogTable).toContain(
      "CREATE TABLE IF NOT EXISTS `wide_events`.`attribute_catalog`",
    );
    expect(catalogTable).toContain("`storage_state` LowCardinality(String)");
    expect(catalogTable).toContain("`seen_rows` Int64 DEFAULT 0");
    expect(catalogTable).toContain(
      "`updated_at` DateTime64(3, 'UTC') DEFAULT now64(3)",
    );
    expect(catalogTable).toContain("ENGINE = ReplacingMergeTree(updated_at)");
    expect(catalogTable).toContain("ORDER BY (`key`)");
  });

  it("maps shared storage types to ClickHouse column types", () => {
    expect(toClickHouseColumnType("VARCHAR", false)).toBe("String");
    expect(toClickHouseColumnType("VARCHAR", true)).toBe("Nullable(String)");
    expect(toClickHouseColumnType("TIMESTAMPTZ", false)).toBe(
      "DateTime64(3, 'UTC')",
    );
    expect(toClickHouseColumnType("DOUBLE", true)).toBe("Nullable(Float64)");
    expect(toClickHouseColumnType("BOOLEAN", true)).toBe("Nullable(Bool)");
    expect(toClickHouseColumnType("INTEGER", false)).toBe("Int32");
    expect(toClickHouseColumnType("BIGINT", false)).toBe("Int64");
    expect(toClickHouseColumnType("JSON", false)).toBe("String");
  });

  it("runs schema initialization commands in dependency order", async () => {
    const command = vi.fn(async (_params: { query: string }) => ({}));

    await initializeClickHouseSchema({ command }, "wide_events");

    expect(command).toHaveBeenCalledTimes(3);
    expect(command.mock.calls[0]?.[0].query).toBe(
      "CREATE DATABASE IF NOT EXISTS `wide_events`",
    );
    expect(command.mock.calls[1]?.[0].query).toContain(
      "CREATE TABLE IF NOT EXISTS `wide_events`.`events`",
    );
    expect(command.mock.calls[2]?.[0].query).toContain(
      "CREATE TABLE IF NOT EXISTS `wide_events`.`attribute_catalog`",
    );
  });

  it("rejects unsafe schema identifiers", () => {
    expect(() => buildClickHouseSchemaStatements("wide events")).toThrow(
      "Unsupported identifier: wide events",
    );
  });
});

function createClickHouseConfig(): Extract<CollectorConfig, { storage: "clickhouse" }> {
  return {
    storage: "clickhouse",
    clickHouse: {
      url: "http://localhost:8123",
      database: "wide_events",
      username: "analytics",
      password: "secret",
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
  };
}
