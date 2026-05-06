import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DynamicEventAttributes, StoredEventRow } from "@wide-events/internal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CollectorConfig } from "../config";
import { QueueLimitExceededError } from "../errors";
import type { CollectorLogger } from "../logger";
import { AttributeCatalog } from "./attribute-catalog";
import { DuckDbDatabase } from "./database";
import { SchemaRegistry } from "./schema-registry";
import { CollectorStore } from "./store";

interface LoggedEvent {
  bindings: Record<string, unknown>;
  message: string;
}

function createRow(
  suffix: string,
  attributes: DynamicEventAttributes = {},
  ts: string = "2024-01-01T00:00:00.000Z",
  promotedAttributeHints: string[] = [],
): StoredEventRow {
  return {
    correlation_id: `corr-${suffix}`,
    event_id: `event-${suffix}`,
    parent_event_id: null,
    ts,
    duration_ms: 10,
    main: true,
    sample_rate: 1,
    "service.name": "payments",
    "service.environment": "test",
    "service.version": null,
    "http.route": "/checkout",
    "http.status_code": 200,
    "http.request.method": "GET",
    error: false,
    "exception.slug": null,
    "user.id": null,
    "user.type": null,
    "user.org.id": null,
    attributes_overflow: attributes,
    promoted_attribute_hints: promotedAttributeHints,
  };
}

function createLogger(): {
  errors: LoggedEvent[];
  infos: LoggedEvent[];
  logger: CollectorLogger;
  warns: LoggedEvent[];
} {
  const infos: LoggedEvent[] = [];
  const warns: LoggedEvent[] = [];
  const errors: LoggedEvent[] = [];

  return {
    infos,
    warns,
    errors,
    logger: {
      info(bindings, message) {
        infos.push({ bindings, message });
      },
      warn(bindings, message) {
        warns.push({ bindings, message });
      },
      error(bindings, message) {
        errors.push({ bindings, message });
      },
    },
  };
}

describe("CollectorStore", () => {
  let database: DuckDbDatabase;
  let workspaceDir = "";

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), "wide-events-store-"));
    database = await DuckDbDatabase.create(join(workspaceDir, "events.duckdb"));
  });

  afterEach(async () => {
    database.close();
    await rm(workspaceDir, { recursive: true, force: true });
  });

  it("flushes when the batch size is reached", async () => {
    const schema = new SchemaRegistry(200);
    await schema.hydrate(database);
    const catalog = new AttributeCatalog();
    await catalog.hydrate(database);
    const store = new CollectorStore(
      database,
      schema,
      catalog,
      configOverrides({
        batchSize: 2,
        batchTimeoutMs: 5_000,
      }),
    );

    let firstResolved = false;
    const firstBatch = store.enqueueRows([createRow("one")]).then(() => {
      firstResolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(firstResolved).toBe(false);

    await Promise.all([firstBatch, store.enqueueRows([createRow("two")])]);

    const rows = await database.executeRead(
      "SELECT COUNT(*) AS total FROM events",
    );
    expect(rows[0]?.["total"]).toBe(2);
  });

  it("flushes on the batch timeout", async () => {
    const schema = new SchemaRegistry(200);
    await schema.hydrate(database);
    const catalog = new AttributeCatalog();
    await catalog.hydrate(database);
    const store = new CollectorStore(
      database,
      schema,
      catalog,
      configOverrides({
        batchSize: 10,
        batchTimeoutMs: 25,
      }),
    );

    await store.enqueueRows([createRow("one")]);

    const rows = await database.executeRead(
      "SELECT COUNT(*) AS total FROM events",
    );
    expect(rows[0]?.["total"]).toBe(1);
  });

  it("returns a queue saturation error when the pending queue exceeds the limit", async () => {
    const schema = new SchemaRegistry(200);
    await schema.hydrate(database);
    const catalog = new AttributeCatalog();
    await catalog.hydrate(database);
    const store = new CollectorStore(
      database,
      schema,
      catalog,
      configOverrides({
        batchSize: 10,
        batchTimeoutMs: 5_000,
        queueLimit: 1,
      }),
    );

    const firstBatch = store.enqueueRows([createRow("one")]);

    await expect(store.enqueueRows([createRow("two")])).rejects.toBeInstanceOf(
      QueueLimitExceededError,
    );

    await store.flush();
    await firstBatch;
  });

  it("stores dynamic attributes in overflow and reports them in the catalog", async () => {
    const schema = new SchemaRegistry(200);
    await schema.hydrate(database);
    const catalog = new AttributeCatalog();
    await catalog.hydrate(database);
    const { logger, warns } = createLogger();
    const store = new CollectorStore(
      database,
      schema,
      catalog,
      configOverrides({
        batchSize: 1,
        batchTimeoutMs: 5,
      }),
      logger,
    );

    await store.enqueueRows([
      createRow("one", {
        "custom.one": "alpha",
        "custom.two": "beta",
      }),
    ]);

    const columns = catalog.listColumns(schema).map((column) => column.name);
    expect(columns).toContain("custom.one");
    expect(columns).toContain("custom.two");

    const rows = await database.executeRead(
      "SELECT attributes_overflow FROM events WHERE correlation_id = ?",
      ["corr-one"],
    );
    expect(rows[0]?.["attributes_overflow"]).toEqual({
      "custom.one": "alpha",
      "custom.two": "beta",
    });
    expect(warns).toHaveLength(0);
  });

  it("promotes eligible overflow keys and writes subsequent rows to the promoted column", async () => {
    const schema = new SchemaRegistry(200);
    await schema.hydrate(database);
    const catalog = new AttributeCatalog();
    await catalog.hydrate(database);
    const store = new CollectorStore(
      database,
      schema,
      catalog,
      configOverrides({
        batchSize: 1,
        batchTimeoutMs: 5,
        promotionMinRows: 1,
        promotionMinRatio: 0.5,
        promotionMaxKeysPerRun: 1,
      }),
    );

    await store.enqueueRows([
      createRow("one", {
        "shared.value": "left",
      }),
    ]);
    await store.runPromotionCycle();
    await store.enqueueRows([
      createRow("two", {
        "shared.value": "right",
      }),
    ]);

    const rows = await database.executeRead(
      'SELECT "shared.value" AS shared_value, attributes_overflow FROM events ORDER BY correlation_id ASC',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.["shared_value"]).toBe("left");
    expect(rows[1]?.["shared_value"]).toBe("right");
    expect(rows[0]?.["attributes_overflow"]).toEqual({ "shared.value": "left" });
    expect(rows[1]?.["attributes_overflow"]).toEqual({});
  });

  it("promotes hinted keys before the first insert and keeps them out of overflow", async () => {
    const schema = new SchemaRegistry(200);
    await schema.hydrate(database);
    const catalog = new AttributeCatalog();
    await catalog.hydrate(database);
    const store = new CollectorStore(
      database,
      schema,
      catalog,
      configOverrides({
        batchSize: 1,
        batchTimeoutMs: 5,
      }),
    );

    await store.enqueueRows([
      createRow(
        "one",
        {
          "custom.value": "alpha",
          "custom.other": "beta",
        },
        "2024-01-01T00:00:00.000Z",
        ["custom.value"],
      ),
    ]);

    const rows = await database.executeRead(
      'SELECT "custom.value" AS custom_value, attributes_overflow FROM events WHERE correlation_id = ?',
      ["corr-one"],
    );
    expect(rows[0]?.["custom_value"]).toBe("alpha");
    expect(rows[0]?.["attributes_overflow"]).toEqual({ "custom.other": "beta" });
    expect(catalog.getEntry("custom.value")?.storageState).toBe("promoted");
  });

  it("treats repeated hinted promotion as a no-op while continuing to write the promoted column", async () => {
    const schema = new SchemaRegistry(200);
    await schema.hydrate(database);
    const catalog = new AttributeCatalog();
    await catalog.hydrate(database);
    const store = new CollectorStore(
      database,
      schema,
      catalog,
      configOverrides({
        batchSize: 1,
        batchTimeoutMs: 5,
      }),
    );

    await store.enqueueRows([
      createRow("one", { "custom.value": "alpha" }, "2024-01-01T00:00:00.000Z", [
        "custom.value",
      ]),
    ]);
    const firstPromotedAt = catalog.getEntry("custom.value")?.promotedAt;

    await store.enqueueRows([
      createRow("two", { "custom.value": "beta" }, "2024-01-01T00:00:00.000Z", [
        "custom.value",
      ]),
    ]);

    const rows = await database.executeRead(
      'SELECT "custom.value" AS custom_value, attributes_overflow FROM events ORDER BY correlation_id ASC',
    );
    expect(rows.map((row) => row["custom_value"])).toEqual(["alpha", "beta"]);
    expect(rows.map((row) => row["attributes_overflow"])).toEqual([{}, {}]);
    expect(catalog.getEntry("custom.value")?.promotedAt).toBe(firstPromotedAt);
  });

  it("writes multiple promoted columns using the correct raw key to column mapping", async () => {
    const schema = new SchemaRegistry(200);
    await schema.hydrate(database);
    const catalog = new AttributeCatalog();
    await catalog.hydrate(database);
    const store = new CollectorStore(
      database,
      schema,
      catalog,
      configOverrides({
        batchSize: 1,
        batchTimeoutMs: 5,
      }),
    );

    await store.enqueueRows([
      createRow(
        "one",
        {
          "custom.name": "alpha",
          "custom.score": 7,
          "custom.other": "kept"
        },
        "2024-01-01T00:00:00.000Z",
        ["custom.name", "custom.score"],
      ),
    ]);

    await store.enqueueRows([
      createRow(
        "two",
        {
          "custom.name": "beta",
          "custom.score": 11
        },
        "2024-01-01T00:00:00.000Z",
        ["custom.name", "custom.score"],
      ),
    ]);

    const rows = await database.executeRead(
      'SELECT "custom.name" AS custom_name, "custom.score" AS custom_score, attributes_overflow FROM events ORDER BY correlation_id ASC',
    );

    expect(rows).toEqual([
      {
        custom_name: "alpha",
        custom_score: 7,
        attributes_overflow: { "custom.other": "kept" }
      },
      {
        custom_name: "beta",
        custom_score: 11,
        attributes_overflow: {}
      }
    ]);
  });

  it("preserves overflow rows without allocating a filtered copy when no promoted keys are present", async () => {
    const schema = new SchemaRegistry(200);
    await schema.hydrate(database);
    const catalog = new AttributeCatalog();
    await catalog.hydrate(database);
    const store = new CollectorStore(
      database,
      schema,
      catalog,
      configOverrides({
        batchSize: 1,
        batchTimeoutMs: 5,
      }),
    );

    await store.enqueueRows([
      createRow("one", {
        "custom.alpha": "left",
        "custom.beta": "right"
      }),
    ]);

    const rows = await database.executeRead(
      "SELECT attributes_overflow FROM events WHERE correlation_id = ?",
      ["corr-one"],
    );
    expect(rows[0]?.["attributes_overflow"]).toEqual({
      "custom.alpha": "left",
      "custom.beta": "right"
    });
  });

  it("rejects hinted baseline columns", async () => {
    const schema = new SchemaRegistry(200);
    await schema.hydrate(database);
    const catalog = new AttributeCatalog();
    await catalog.hydrate(database);
    const store = new CollectorStore(
      database,
      schema,
      catalog,
      configOverrides({
        batchSize: 1,
        batchTimeoutMs: 5,
      }),
    );

    await expect(
      store.enqueueRows([
        createRow(
          "one",
          { "user.id": "u_123" },
          "2024-01-01T00:00:00.000Z",
          ["user.id"],
        ),
      ]),
    ).rejects.toThrow(/Cannot promote baseline column "user.id"/);
  });

  it("rejects hinted keys that are missing from the row attributes", async () => {
    const schema = new SchemaRegistry(200);
    await schema.hydrate(database);
    const catalog = new AttributeCatalog();
    await catalog.hydrate(database);
    const store = new CollectorStore(
      database,
      schema,
      catalog,
      configOverrides({
        batchSize: 1,
        batchTimeoutMs: 5,
      }),
    );

    await expect(
      store.enqueueRows([
        createRow("one", { "custom.value": "alpha" }, "2024-01-01T00:00:00.000Z", [
          "custom.missing",
        ]),
      ]),
    ).rejects.toThrow(/Promotion hint "custom.missing" was not present/);
  });

  it("rejects hinted promotion when the merged type would become JSON", async () => {
    const schema = new SchemaRegistry(200);
    await schema.hydrate(database);
    const catalog = new AttributeCatalog();
    await catalog.hydrate(database);
    const store = new CollectorStore(
      database,
      schema,
      catalog,
      configOverrides({
        batchSize: 1,
        batchTimeoutMs: 5,
      }),
    );

    await store.enqueueRows([
      createRow("one", { "custom.value": 1 }, "2024-01-01T00:00:00.000Z"),
    ]);

    await expect(
      store.enqueueRows([
        createRow(
          "two",
          { "custom.value": "alpha" },
          "2024-01-01T00:00:00.000Z",
          ["custom.value"],
        ),
      ]),
    ).rejects.toThrow(/Promotion hint "custom.value" requires a primitive value/);
  });

  it("serializes retention alongside ingest", async () => {
    const schema = new SchemaRegistry(200);
    await schema.hydrate(database);
    const catalog = new AttributeCatalog();
    await catalog.hydrate(database);
    const { logger, infos } = createLogger();
    const store = new CollectorStore(
      database,
      schema,
      catalog,
      configOverrides({
        batchSize: 1,
        batchTimeoutMs: 5,
        retentionDays: 30,
      }),
      logger,
    );

    await store.enqueueRows([createRow("old", {}, "2024-01-01T00:00:00.000Z")]);

    await Promise.all([
      store.runRetention(new Date("2024-03-15T00:00:00.000Z")),
      store.enqueueRows([createRow("new", {}, "2024-03-14T00:00:00.000Z")]),
    ]);

    const rows = await database.executeRead(
      "SELECT correlation_id FROM events ORDER BY correlation_id ASC",
    );
    expect(rows).toEqual([{ correlation_id: "corr-new" }]);
    expect(
      infos.some((entry) => entry.message === "collector retention started"),
    ).toBe(true);
    expect(
      infos.some((entry) => entry.message === "collector retention completed"),
    ).toBe(true);
  });
});

function configOverrides(overrides: Partial<CollectorConfig>): CollectorConfig {
  return {
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
    ...overrides,
  };
}
