import { createClient } from "@clickhouse/client";
import type {
  AttributeCatalogEntry,
  InferredAttributeType,
  QueryRow,
} from "@wide-events/internal";
import type { CollectorConfig } from "../../config.js";
import { clickHouseQuerySqlDialect } from "../../query/dialect.js";
import {
  ATTRIBUTE_CATALOG_COLUMNS,
  attributeCatalogEntryFromRow,
  attributeCatalogEntryToRow,
} from "../attribute-catalog-row.js";
import type {
  CollectorDatabase,
  CollectorInsertRow,
  CollectorTableColumn,
} from "../types.js";
import type {
  ClickHouseStorageClient,
  ClickHouseStorageClientFactory,
} from "./client.js";
import { toClickHouseClientOptions } from "./client.js";
import {
  expectClickHouseRows,
  normalizeClickHouseRows,
  serializeClickHouseInsertValue,
  toNonEmptyArray,
} from "./codec.js";
import {
  clickHouseQualifiedIdentifier,
  clickHouseQuoteIdentifier,
  initializeClickHouseSchema,
  toClickHouseColumnType,
} from "./schema.js";
import {
  bindClickHouseReadParams,
  buildClickHouseBackfillExpression,
} from "./sql.js";

export class ClickHouseDatabase implements CollectorDatabase {
  readonly queryDialect = clickHouseQuerySqlDialect;

  private constructor(
    private readonly client: ClickHouseStorageClient,
    private readonly database: string,
  ) {}

  static async create(
    config: Extract<CollectorConfig, { storage: "clickhouse" }>,
    factory: ClickHouseStorageClientFactory = createClient,
  ): Promise<ClickHouseDatabase> {
    const client = factory(toClickHouseClientOptions(config));
    const database = new ClickHouseDatabase(client, config.clickHouse.database);
    await database.ping();
    await initializeClickHouseSchema(client, config.clickHouse.database);
    return database;
  }

  async executeRead(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<QueryRow[]> {
    return await this.queryRows(bindClickHouseReadParams(sql, values));
  }

  async readColumns(table: string): Promise<CollectorTableColumn[]> {
    const rows = await this.queryRows({
      query: `SELECT name, type
FROM system.columns
WHERE database = {database:String}
  AND table = {table:String}
ORDER BY position`,
      query_params: {
        database: this.database,
        table,
      },
    });

    return rows.map((row) => ({
      name: expectString(row["name"], "table column name"),
      type: expectString(row["type"], "table column type"),
    }));
  }

  async addPromotedColumn(
    table: string,
    column: string,
    type: InferredAttributeType,
  ): Promise<void> {
    await this.client.command({
      query: `ALTER TABLE ${clickHouseQualifiedIdentifier(
        this.database,
        table,
      )} ADD COLUMN IF NOT EXISTS ${clickHouseQuoteIdentifier(
        column,
      )} ${toClickHouseColumnType(type, true)}`,
    });
  }

  async backfillPromotedColumn(
    column: string,
    type: InferredAttributeType,
    rawKey: string,
  ): Promise<void> {
    await this.client.command({
      query: `ALTER TABLE ${clickHouseQualifiedIdentifier(this.database, "events")}
UPDATE ${clickHouseQuoteIdentifier(column)} = ${buildClickHouseBackfillExpression(
        type,
      )}
WHERE isNull(${clickHouseQuoteIdentifier(column)})
  AND mapContains(${clickHouseQuoteIdentifier("attributes_overflow")}, {rawKey:String})`,
      query_params: {
        rawKey,
      },
    });
  }

  async insertEventRows(
    columns: readonly string[],
    rows: readonly CollectorInsertRow[],
  ): Promise<void> {
    await this.insertRows("events", columns, rows);
  }

  async insertProjectEventRows(
    columns: readonly string[],
    rows: readonly CollectorInsertRow[],
  ): Promise<void> {
    await this.insertRows("project_events", columns, rows);
  }

  async loadAttributeCatalog(): Promise<AttributeCatalogEntry[]> {
    const rows = await this.queryRows({
      query: `SELECT ${ATTRIBUTE_CATALOG_COLUMNS.map(clickHouseQuoteIdentifier).join(
        ", ",
      )}
FROM ${clickHouseQualifiedIdentifier(this.database, "attribute_catalog")} FINAL`,
    });
    return rows.map(attributeCatalogEntryFromRow);
  }

  async saveAttributeCatalogEntry(entry: AttributeCatalogEntry): Promise<void> {
    await this.insertRows("attribute_catalog", ATTRIBUTE_CATALOG_COLUMNS, [
      attributeCatalogEntryToRow(entry),
    ]);
  }

  async deleteEventsBefore(cutoff: string): Promise<void> {
    await this.client.command({
      query: `ALTER TABLE ${clickHouseQualifiedIdentifier(this.database, "events")}
DELETE WHERE ${clickHouseQuoteIdentifier(
        "ts",
      )} < parseDateTime64BestEffort({cutoff:String}, 3, 'UTC')`,
      query_params: {
        cutoff,
      },
    });
    await this.client.command({
      query: `ALTER TABLE ${clickHouseQualifiedIdentifier(
        this.database,
        "project_events",
      )}
DELETE WHERE ${clickHouseQuoteIdentifier(
        "ts",
      )} < parseDateTime64BestEffort({cutoff:String}, 3, 'UTC')`,
      query_params: {
        cutoff,
      },
    });
  }

  async runRetentionMaintenance(): Promise<void> {
    // ClickHouse retention runs as a table mutation; there is no DuckDB-style checkpoint.
  }

  async countEvents(): Promise<number> {
    const rows = await this.queryRows({
      query: `SELECT COUNT(*) AS total
FROM ${clickHouseQualifiedIdentifier(this.database, "events")}`,
    });
    return toCount(rows[0]?.["total"]);
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private async insertRows(
    table: string,
    columns: readonly string[],
    rows: readonly CollectorInsertRow[],
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    await this.client.insert({
      table: clickHouseQualifiedIdentifier(this.database, table),
      columns: toNonEmptyArray(columns.map(clickHouseQuoteIdentifier)),
      values: rows.map((row) =>
        columns.map((column) => serializeClickHouseInsertValue(column, row[column])),
      ),
      format: "JSONCompactEachRow",
    });
  }

  private async queryRows(params: {
    query: string;
    query_params?: Record<string, unknown>;
  }): Promise<QueryRow[]> {
    const resultSet = await this.client.query({
      ...params,
      format: "JSONEachRow",
    });
    const rows = await resultSet.json();
    return normalizeClickHouseRows(expectClickHouseRows(rows));
  }

  private async ping(): Promise<void> {
    const result = await this.client.ping();
    if (!result.success) {
      throw new Error(
        `ClickHouse ping failed: ${
          result.error instanceof Error ? result.error.message : "unknown error"
        }`,
      );
    }
  }
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }

  return value;
}

function toCount(value: unknown): number {
  return typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number.parseInt(value, 10)
      : 0;
}
