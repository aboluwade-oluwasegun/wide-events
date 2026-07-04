import type {
  AttributeCatalogEntry,
  InferredAttributeType,
  QueryRow,
} from "@wide-events/internal";
import type { QuerySqlDialect } from "../query/dialect.js";

export type CollectorInsertRow = Record<string, unknown>;

export interface CollectorTableColumn {
  name: string;
  type: string;
}

export interface CollectorDatabase {
  readonly queryDialect: QuerySqlDialect;
  executeRead(sql: string, values?: readonly unknown[]): Promise<QueryRow[]>;
  readColumns(table: string): Promise<CollectorTableColumn[]>;
  addPromotedColumn(
    table: string,
    column: string,
    type: InferredAttributeType,
  ): Promise<void>;
  backfillPromotedColumn(
    column: string,
    type: InferredAttributeType,
    rawKey: string,
  ): Promise<void>;
  insertEventRows(
    columns: readonly string[],
    rows: readonly CollectorInsertRow[],
  ): Promise<void>;
  insertProjectEventRows(
    columns: readonly string[],
    rows: readonly CollectorInsertRow[],
  ): Promise<void>;
  loadAttributeCatalog(): Promise<AttributeCatalogEntry[]>;
  saveAttributeCatalogEntry(entry: AttributeCatalogEntry): Promise<void>;
  deleteEventsBefore(cutoff: string): Promise<void>;
  runRetentionMaintenance(): Promise<void>;
  countEvents(): Promise<number>;
  close(): void | Promise<void>;
}
