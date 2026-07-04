import { describe, expect, it, vi } from "vitest";
import type { CollectorConfig } from "../../config";
import { ClickHouseDatabase } from "./database";

describe("ClickHouseDatabase", () => {
  it("creates a client, pings, initializes schema, and closes", async () => {
    const client = createMockClickHouseClient();
    const factory = vi.fn(() => client);

    const database = await ClickHouseDatabase.create(
      createClickHouseConfig(),
      factory,
    );

    expect(factory).toHaveBeenCalledWith({
      url: "http://localhost:8123",
      database: "wide_events",
      username: "analytics",
      password: "secret",
      application: "wide-events-collector",
    });
    expect(client.ping).toHaveBeenCalledTimes(1);
    expect(client.command).toHaveBeenCalledTimes(4);
    expect(client.command.mock.calls[0]?.[0].query).toBe(
      "CREATE DATABASE IF NOT EXISTS `wide_events`",
    );

    await database.close();
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it("surfaces failed pings", async () => {
    const client = createMockClickHouseClient();
    client.ping.mockResolvedValueOnce({
      success: false,
      error: new Error("authentication failed"),
    });

    await expect(
      ClickHouseDatabase.create(createClickHouseConfig(), () => client),
    ).rejects.toThrow("ClickHouse ping failed: authentication failed");
  });

  it("keeps positional binding only on read queries", async () => {
    const client = createMockClickHouseClient([
      {
        total: "42",
        nested: { value: 1 },
        values: [1, "two", true],
      },
    ]);
    const database = await ClickHouseDatabase.create(
      createClickHouseConfig(),
      () => client,
    );

    const rows = await database.executeRead(
      "SELECT total FROM events WHERE sample_rate > ? AND main = ?",
      [1, true],
    );

    expect(client.query).toHaveBeenCalledWith({
      query:
        "SELECT total FROM events WHERE sample_rate > {p0:Int64} AND main = {p1:Bool}",
      query_params: {
        p0: 1,
        p1: true,
      },
      format: "JSONEachRow",
    });
    expect(rows).toEqual([
      {
        total: "42",
        nested: { value: 1 },
        values: [1, "two", true],
      },
    ]);
  });

  it("reads table columns through a backend-owned query", async () => {
    const client = createMockClickHouseClient([
      { name: "event_id", type: "String" },
      { name: "custom.count", type: "Nullable(Int64)" },
    ]);
    const database = await ClickHouseDatabase.create(
      createClickHouseConfig(),
      () => client,
    );

    expect(await database.readColumns("events")).toEqual([
      { name: "event_id", type: "String" },
      { name: "custom.count", type: "Nullable(Int64)" },
    ]);
    expect(client.query).toHaveBeenLastCalledWith({
      query: `SELECT name, type
FROM system.columns
WHERE database = {database:String}
  AND table = {table:String}
ORDER BY position`,
      query_params: {
        database: "wide_events",
        table: "events",
      },
      format: "JSONEachRow",
    });
  });

  it("adds promoted columns without exposing storage dialect SQL", async () => {
    const client = createMockClickHouseClient();
    const database = await ClickHouseDatabase.create(
      createClickHouseConfig(),
      () => client,
    );
    client.command.mockClear();

    await database.addPromotedColumn("events", "custom.count", "BIGINT");

    expect(client.command).toHaveBeenCalledWith({
      query:
        "ALTER TABLE `wide_events`.`events` ADD COLUMN IF NOT EXISTS `custom.count` Nullable(Int64)",
    });
  });

  it("backfills promoted columns with explicit ClickHouse params", async () => {
    const client = createMockClickHouseClient();
    const database = await ClickHouseDatabase.create(
      createClickHouseConfig(),
      () => client,
    );
    client.command.mockClear();

    await database.backfillPromotedColumn(
      "custom.count",
      "BIGINT",
      "custom.count",
    );

    expect(client.command).toHaveBeenCalledWith({
      query: `ALTER TABLE \`wide_events\`.\`events\`
UPDATE \`custom.count\` = toInt64OrNull(\`attributes_overflow\`[{rawKey:String}])
WHERE isNull(\`custom.count\`)
  AND mapContains(\`attributes_overflow\`, {rawKey:String})`,
      query_params: {
        rawKey: "custom.count",
      },
    });
  });

  it("inserts event rows with compact positional values", async () => {
    const client = createMockClickHouseClient();
    const database = await ClickHouseDatabase.create(
      createClickHouseConfig(),
      () => client,
    );

    await database.insertEventRows(
      ["event_id", "attributes_overflow", "duration_ms"],
      [
        {
          event_id: "event-1",
          duration_ms: 12.5,
          attributes_overflow: {
            "custom.count": 2,
            "custom.name": "alpha",
            "custom.null": null,
          },
        },
      ],
    );

    expect(client.insert).toHaveBeenCalledWith({
      table: "`wide_events`.`events`",
      columns: ["`event_id`", "`attributes_overflow`", "`duration_ms`"],
      values: [
        [
          "event-1",
          {
            "custom.count": "2",
            "custom.name": "alpha",
            "custom.null": "null",
          },
          12.5,
        ],
      ],
      format: "JSONCompactEachRow",
    });
  });

  it("inserts project event rows into the project_events table", async () => {
    const client = createMockClickHouseClient();
    const database = await ClickHouseDatabase.create(
      createClickHouseConfig(),
      () => client,
    );

    await database.insertProjectEventRows(
      [
        "event_id",
        "correlation_id",
        "ts",
        "project_id",
        "project_fields",
        "project_field_types",
      ],
      [
        {
          event_id: "event-project",
          correlation_id: "corr-project",
          ts: "2024-01-01T00:00:00.000Z",
          project_id: "project_123",
          project_fields: {
            "order.total": 42.5,
            "payload.raw": { sku: "sku_123" },
          },
          project_field_types: {
            "order.total": "DOUBLE",
            "payload.raw": "JSON",
          },
        },
      ],
    );

    expect(client.insert).toHaveBeenCalledWith({
      table: "`wide_events`.`project_events`",
      columns: [
        "`event_id`",
        "`correlation_id`",
        "`ts`",
        "`project_id`",
        "`project_fields`",
        "`project_field_types`",
      ],
      values: [
        [
          "event-project",
          "corr-project",
          "2024-01-01T00:00:00.000Z",
          "project_123",
          {
            "order.total": "42.5",
            "payload.raw": "{\"sku\":\"sku_123\"}",
          },
          {
            "order.total": "DOUBLE",
            "payload.raw": "JSON",
          },
        ],
      ],
      format: "JSONCompactEachRow",
    });
  });

  it("appends attribute catalog versions for ReplacingMergeTree", async () => {
    const client = createMockClickHouseClient();
    const database = await ClickHouseDatabase.create(
      createClickHouseConfig(),
      () => client,
    );

    await database.saveAttributeCatalogEntry({
      key: "custom.count",
      sanitizedKey: "custom.count",
      storageState: "promoted",
      inferredType: "BIGINT",
      seenRows: 10,
      nonNullRows: 9,
      firstSeenAt: "2024-01-01T00:00:00.000Z",
      lastSeenAt: "2024-01-02T00:00:00.000Z",
      promotedColumn: "custom.count",
      promotedType: "BIGINT",
      promotedAt: "2024-01-02T00:00:00.000Z",
      lastError: null,
    });

    expect(client.insert).toHaveBeenCalledWith({
      table: "`wide_events`.`attribute_catalog`",
      columns: [
        "`key`",
        "`sanitized_key`",
        "`storage_state`",
        "`inferred_type`",
        "`seen_rows`",
        "`non_null_rows`",
        "`first_seen_at`",
        "`last_seen_at`",
        "`promoted_column`",
        "`promoted_type`",
        "`promoted_at`",
        "`last_error`",
      ],
      values: [
        [
          "custom.count",
          "custom.count",
          "promoted",
          "BIGINT",
          10,
          9,
          "2024-01-01T00:00:00.000Z",
          "2024-01-02T00:00:00.000Z",
          "custom.count",
          "BIGINT",
          "2024-01-02T00:00:00.000Z",
          null,
        ],
      ],
      format: "JSONCompactEachRow",
    });
  });

  it("hydrates the attribute catalog through FINAL so stale versions are collapsed", async () => {
    const client = createMockClickHouseClient([
      {
        key: "custom.count",
        sanitized_key: "custom.count",
        storage_state: "promoted",
        inferred_type: "BIGINT",
        seen_rows: 10,
        non_null_rows: 9,
        first_seen_at: "2024-01-01T00:00:00.000Z",
        last_seen_at: "2024-01-02T00:00:00.000Z",
        promoted_column: "custom.count",
        promoted_type: "BIGINT",
        promoted_at: "2024-01-02T00:00:00.000Z",
        last_error: null,
      },
    ]);
    const database = await ClickHouseDatabase.create(
      createClickHouseConfig(),
      () => client,
    );

    await expect(database.loadAttributeCatalog()).resolves.toEqual([
      {
        key: "custom.count",
        sanitizedKey: "custom.count",
        storageState: "promoted",
        inferredType: "BIGINT",
        seenRows: 10,
        nonNullRows: 9,
        firstSeenAt: "2024-01-01T00:00:00.000Z",
        lastSeenAt: "2024-01-02T00:00:00.000Z",
        promotedColumn: "custom.count",
        promotedType: "BIGINT",
        promotedAt: "2024-01-02T00:00:00.000Z",
        lastError: null,
      },
    ]);
    expect(client.query).toHaveBeenLastCalledWith({
      query:
        "SELECT `key`, `sanitized_key`, `storage_state`, `inferred_type`, `seen_rows`, `non_null_rows`, `first_seen_at`, `last_seen_at`, `promoted_column`, `promoted_type`, `promoted_at`, `last_error`\nFROM `wide_events`.`attribute_catalog` FINAL",
      format: "JSONEachRow",
    });
  });

  it("runs ClickHouse retention as a table mutation", async () => {
    const client = createMockClickHouseClient();
    const database = await ClickHouseDatabase.create(
      createClickHouseConfig(),
      () => client,
    );
    client.command.mockClear();

    await database.deleteEventsBefore("2024-01-01T00:00:00.000Z");
    await database.runRetentionMaintenance();

    expect(client.command).toHaveBeenCalledTimes(2);
    expect(client.command.mock.calls[0]?.[0]).toEqual({
      query: `ALTER TABLE \`wide_events\`.\`events\`
DELETE WHERE \`ts\` < parseDateTime64BestEffort({cutoff:String}, 3, 'UTC')`,
      query_params: {
        cutoff: "2024-01-01T00:00:00.000Z",
      },
    });
    expect(client.command.mock.calls[1]?.[0]).toEqual({
      query: `ALTER TABLE \`wide_events\`.\`project_events\`
DELETE WHERE \`ts\` < parseDateTime64BestEffort({cutoff:String}, 3, 'UTC')`,
      query_params: {
        cutoff: "2024-01-01T00:00:00.000Z",
      },
    });
  });

  it("counts retained events through a backend-owned query", async () => {
    const client = createMockClickHouseClient([{ total: "12" }]);
    const database = await ClickHouseDatabase.create(
      createClickHouseConfig(),
      () => client,
    );

    await expect(database.countEvents()).resolves.toBe(12);
    expect(client.query).toHaveBeenLastCalledWith({
      query: `SELECT COUNT(*) AS total
FROM \`wide_events\`.\`events\``,
      format: "JSONEachRow",
    });
  });
});

function createMockClickHouseClient(rows: unknown[] = []) {
  const query = vi.fn(
    async (): Promise<{ json(): Promise<unknown[]> }> => ({
      json: async () => rows,
    }),
  );
  const ping = vi.fn(
    async (): Promise<{ success: boolean; error?: Error }> => ({
      success: true,
    }),
  );

  return {
    close: vi.fn(async () => {}),
    command: vi.fn(
      async (_params: { query: string; query_params?: Record<string, unknown> }) =>
        ({}),
    ),
    insert: vi.fn(async () => ({})),
    ping,
    query,
  };
}

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
    projectConfigTtlSeconds: 60,
    projects: [],
  };
}
