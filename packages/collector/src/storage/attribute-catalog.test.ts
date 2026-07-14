import type { StoredEventRow } from "@wide-events/internal";
import { describe, expect, it, vi } from "vitest";
import { duckDbQuerySqlDialect } from "../query/dialect";
import { AttributeCatalog } from "./attribute-catalog";
import type { CollectorDatabase } from "./types";

describe("AttributeCatalog", () => {
  it("does not add recorded rows to memory when persistence fails", async () => {
    const catalog = new AttributeCatalog();
    const { database, saveAttributeCatalogEntry } = createCatalogDatabase();
    saveAttributeCatalogEntry.mockRejectedValueOnce(new Error("catalog unavailable"));

    await expect(
      catalog.recordRows(database, [createRow({ "custom.value": "alpha" })]),
    ).rejects.toThrow("catalog unavailable");

    expect(catalog.getEntry("custom.value")).toBeNull();
  });

  it("keeps the previous state when marking a key as promoting fails", async () => {
    const catalog = new AttributeCatalog();
    const { database, saveAttributeCatalogEntry } = createCatalogDatabase();
    await catalog.recordRows(database, [createRow({ "custom.value": "alpha" })]);

    saveAttributeCatalogEntry.mockRejectedValueOnce(new Error("catalog unavailable"));

    await expect(catalog.markPromoting(database, "custom.value")).rejects.toThrow(
      "catalog unavailable",
    );
    expect(catalog.getEntry("custom.value")?.storageState).toBe("overflow_only");
  });

  it("keeps the previous state when marking a key as promoted fails", async () => {
    const catalog = new AttributeCatalog();
    const { database, saveAttributeCatalogEntry } = createCatalogDatabase();
    await catalog.recordRows(database, [createRow({ "custom.value": "alpha" })]);

    saveAttributeCatalogEntry.mockRejectedValueOnce(new Error("catalog unavailable"));

    await expect(
      catalog.markPromoted(database, "custom.value", "custom.value", "VARCHAR"),
    ).rejects.toThrow("catalog unavailable");
    expect(catalog.getEntry("custom.value")?.storageState).toBe("overflow_only");
  });

  it("keeps the previous state when marking a key as failed fails", async () => {
    const catalog = new AttributeCatalog();
    const { database, saveAttributeCatalogEntry } = createCatalogDatabase();
    await catalog.recordRows(database, [createRow({ "custom.value": "alpha" })]);
    await catalog.markPromoting(database, "custom.value");

    saveAttributeCatalogEntry.mockRejectedValueOnce(new Error("catalog unavailable"));

    await expect(
      catalog.markFailed(database, "custom.value", new Error("promotion failed")),
    ).rejects.toThrow("catalog unavailable");
    expect(catalog.getEntry("custom.value")?.storageState).toBe("promoting");
  });
});

function createCatalogDatabase() {
  const saveAttributeCatalogEntry = vi
    .fn<CollectorDatabase["saveAttributeCatalogEntry"]>()
    .mockResolvedValue(undefined);
  const database: CollectorDatabase = {
    queryDialect: duckDbQuerySqlDialect,
    async executeRead() {
      return [];
    },
    async readColumns() {
      return [];
    },
    async addPromotedColumn() {},
    async backfillPromotedColumn() {},
    async writeIngestBatch() {},
    async loadAttributeCatalog() {
      return [];
    },
    saveAttributeCatalogEntry,
    async deleteEventsBefore() {},
    async runRetentionMaintenance() {},
    async countEvents() {
      return 0;
    },
    close() {},
  };

  return { database, saveAttributeCatalogEntry };
}

function createRow(attributes: StoredEventRow["attributes_overflow"]): StoredEventRow {
  return {
    correlation_id: "corr-1",
    event_id: "event-1",
    parent_event_id: null,
    ts: "2024-01-01T00:00:00.000Z",
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
    promoted_attribute_hints: [],
  };
}
