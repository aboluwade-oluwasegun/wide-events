import { describe, expect, it } from "vitest";
import { readCollectorConfig } from "./config";

describe("readCollectorConfig", () => {
  it("defaults to DuckDB storage with existing collector defaults", () => {
    const config = readCollectorConfig({
      WIDE_EVENTS_DUCKDB_PATH: "./wide-events.db"
    });

    expect(config).toMatchObject({
      storage: "duckdb",
      duckDbPath: "./wide-events.db",
      port: 4318,
      batchSize: 100,
      batchTimeoutMs: 1_000,
      retentionDays: 30
    });
  });

  it("parses explicit DuckDB storage env", () => {
    const config = readCollectorConfig({
      WIDE_EVENTS_STORAGE: "duckdb",
      WIDE_EVENTS_DUCKDB_PATH: "/data/wide-events.db",
      WIDE_EVENTS_COLLECTOR_PORT: "4319",
      WIDE_EVENTS_BATCH_SIZE: "25"
    });

    expect(config).toMatchObject({
      storage: "duckdb",
      duckDbPath: "/data/wide-events.db",
      port: 4319,
      batchSize: 25
    });
  });

  it("parses ClickHouse storage env", () => {
    const config = readCollectorConfig({
      WIDE_EVENTS_STORAGE: "clickhouse",
      WIDE_EVENTS_CLICKHOUSE_URL: "http://localhost:8123",
      WIDE_EVENTS_CLICKHOUSE_DATABASE: "wide_events",
      WIDE_EVENTS_CLICKHOUSE_USERNAME: "analytics",
      WIDE_EVENTS_CLICKHOUSE_PASSWORD: "secret"
    });

    expect(config).toMatchObject({
      storage: "clickhouse",
      clickHouse: {
        url: "http://localhost:8123",
        database: "wide_events",
        username: "analytics",
        password: "secret"
      }
    });
  });

  it("defaults the ClickHouse username when omitted", () => {
    const config = readCollectorConfig({
      WIDE_EVENTS_STORAGE: "clickhouse",
      WIDE_EVENTS_CLICKHOUSE_URL: "http://localhost:8123",
      WIDE_EVENTS_CLICKHOUSE_DATABASE: "wide_events"
    });

    expect(config.storage).toBe("clickhouse");
    if (config.storage !== "clickhouse") {
      throw new Error("expected ClickHouse config");
    }
    expect(config.clickHouse.username).toBe("default");
  });

  it("rejects DuckDB storage without a DuckDB path", () => {
    expect(() => readCollectorConfig({ WIDE_EVENTS_STORAGE: "duckdb" })).toThrow();
  });

  it("rejects ClickHouse storage without required ClickHouse env", () => {
    expect(() =>
      readCollectorConfig({
        WIDE_EVENTS_STORAGE: "clickhouse",
        WIDE_EVENTS_CLICKHOUSE_URL: "http://localhost:8123"
      })
    ).toThrow();
  });
});
