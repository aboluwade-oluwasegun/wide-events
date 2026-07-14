import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import {
  ATTRIBUTE_CATALOG_SQL,
  BASE_TABLE_SQL,
  PROJECT_EVENTS_TABLE_SQL,
  quoteIdentifier,
  type AttributeCatalogEntry,
  type InferredAttributeType,
  type QueryRow,
} from "@wide-events/internal";
import { duckDbQuerySqlDialect } from "../../query/dialect.js";
import {
  ATTRIBUTE_CATALOG_COLUMNS,
  attributeCatalogEntryFromRow,
  attributeCatalogEntryToRow,
} from "../attribute-catalog-row.js";
import type {
  CollectorDatabase,
  CollectorIngestBatch,
  CollectorInsertRow,
  CollectorTableColumn,
} from "../types.js";
import {
  normalizeDuckDbRows,
  serializeDuckDbInsertValue,
  toDuckDbValues,
} from "./codec.js";
import {
  buildDuckDbAttributeCatalogSaveSql,
  buildDuckDbInsertSql,
  buildDuckDbPromotionBackfillSql,
  readDuckDbTableColumnsSql,
} from "./sql.js";

export class DuckDbDatabase implements CollectorDatabase {
  readonly queryDialect = duckDbQuerySqlDialect;

  private constructor(
    private readonly instance: DuckDBInstance,
    private readonly writer: DuckDBConnection,
  ) {}

  static async create(path: string): Promise<DuckDbDatabase> {
    const instance = await DuckDBInstance.create(path);
    const writer = await instance.connect();
    const database = new DuckDbDatabase(instance, writer);
    await database.writer.run(BASE_TABLE_SQL);
    await database.writer.run(PROJECT_EVENTS_TABLE_SQL);
    await database.writer.run(ATTRIBUTE_CATALOG_SQL);
    await database.writer.run(
      "ALTER TABLE events ADD COLUMN IF NOT EXISTS attributes_overflow MAP(VARCHAR, JSON)",
    );
    return database;
  }

  private async execute(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<void> {
    await this.writer.run(sql, toDuckDbValues(values));
  }

  async executeRead(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<QueryRow[]> {
    const readerConnection = await this.instance.connect();
    try {
      const reader = await readerConnection.runAndReadAll(
        sql,
        toDuckDbValues(values),
      );
      return normalizeDuckDbRows(reader.getRowObjectsJS());
    } finally {
      readerConnection.closeSync();
    }
  }

  async readColumns(table: string): Promise<CollectorTableColumn[]> {
    const rows = await this.executeRead(readDuckDbTableColumnsSql(table));
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
    await this.execute(
      `ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN IF NOT EXISTS ${quoteIdentifier(
        column,
      )} ${type}`,
    );
  }

  async backfillPromotedColumn(
    column: string,
    type: InferredAttributeType,
    rawKey: string,
  ): Promise<void> {
    await this.execute(buildDuckDbPromotionBackfillSql(column, type), [
      rawKey,
      rawKey,
    ]);
  }

  async writeIngestBatch(batch: CollectorIngestBatch): Promise<void> {
    if (
      (!batch.eventRows || batch.eventRows.rows.length === 0) &&
      (!batch.projectEventRows || batch.projectEventRows.rows.length === 0)
    ) {
      return;
    }

    await this.execute("BEGIN TRANSACTION");
    try {
      await this.insertRows("events", batch.eventRows?.columns ?? [], batch.eventRows?.rows ?? []);
      await this.insertRows(
        "project_events",
        batch.projectEventRows?.columns ?? [],
        batch.projectEventRows?.rows ?? [],
      );
      await this.execute("COMMIT");
    } catch (error) {
      await this.execute("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  private async insertRows(
    table: "events" | "project_events",
    columns: readonly string[],
    rows: readonly CollectorInsertRow[],
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const values: unknown[] = [];
    for (const row of rows) {
      for (const column of columns) {
        values.push(serializeDuckDbInsertValue(column, row[column]));
      }
    }

    await this.execute(
      buildDuckDbInsertSql(table, columns, rows.length),
      values,
    );
  }

  async loadAttributeCatalog(): Promise<AttributeCatalogEntry[]> {
    const rows = await this.executeRead(`
      SELECT ${ATTRIBUTE_CATALOG_COLUMNS.map(quoteIdentifier).join(", ")}
      FROM attribute_catalog
    `);
    return rows.map(attributeCatalogEntryFromRow);
  }

  async saveAttributeCatalogEntry(entry: AttributeCatalogEntry): Promise<void> {
    const row = attributeCatalogEntryToRow(entry);
    await this.execute(
      buildDuckDbAttributeCatalogSaveSql(),
      ATTRIBUTE_CATALOG_COLUMNS.map((column) => row[column]),
    );
  }

  async deleteEventsBefore(cutoff: string): Promise<void> {
    await this.execute("DELETE FROM events WHERE ts < ?", [cutoff]);
    await this.execute("DELETE FROM project_events WHERE ts < ?", [cutoff]);
  }

  async runRetentionMaintenance(): Promise<void> {
    await this.execute("CHECKPOINT");
  }

  async countEvents(): Promise<number> {
    const rows = await this.executeRead("SELECT COUNT(*) AS total FROM events");
    return toCount(rows[0]?.["total"]);
  }

  close(): void {
    this.writer.closeSync();
    this.instance.closeSync();
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
