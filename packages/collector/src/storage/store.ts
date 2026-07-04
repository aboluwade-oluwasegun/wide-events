import {
  BASELINE_COLUMN_NAMES,
  PROJECT_EVENT_COLUMN_NAMES,
  isBaselineColumn,
  isPrimitiveEventValue,
  sanitizeIdentifier,
  type EventPrimitive,
  type ProjectEventRow,
  type ProjectEventColumnName,
  type StoredEventRow,
  type InferredAttributeType,
} from "@wide-events/internal";
import type { CollectorConfig } from "../config.js";
import { QueueLimitExceededError } from "../errors.js";
import { noopCollectorLogger, type CollectorLogger } from "../logger.js";
import {
  inferValueType,
  mergeInferredType,
  type AttributeCatalog
} from "./attribute-catalog.js";
import type { ProjectSchemaRegistry } from "./project-schema-registry.js";
import type { SchemaRegistry } from "./schema-registry.js";
import { SerializedExecutor } from "./serialized-executor.js";
import type { CollectorDatabase } from "./types.js";

interface PendingBatch {
  rows: StoredEventRow[];
  projectRows: ProjectEventRow[];
  rowCount: number;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export interface StoreIngestBatch {
  defaultRows: readonly StoredEventRow[];
  projectRows: readonly ProjectEventRow[];
}

const PROJECT_EVENT_COLUMN_SET: ReadonlySet<string> = new Set(
  PROJECT_EVENT_COLUMN_NAMES,
);

export class CollectorStore {
  private readonly executor = new SerializedExecutor();
  private readonly pending: PendingBatch[] = [];
  private flushTimer: NodeJS.Timeout | undefined;
  private pendingRowCount = 0;

  constructor(
    private readonly database: CollectorDatabase,
    private readonly schema: SchemaRegistry,
    private readonly projectSchema: ProjectSchemaRegistry,
    private readonly catalog: AttributeCatalog,
    private readonly config: CollectorConfig,
    private readonly logger: CollectorLogger = noopCollectorLogger,
  ) {}

  async enqueueRows(rows: readonly StoredEventRow[]): Promise<void> {
    return await this.enqueueIngestBatch({
      defaultRows: rows,
      projectRows: [],
    });
  }

  async enqueueIngestBatch(batch: StoreIngestBatch): Promise<void> {
    const rowCount = batch.defaultRows.length + batch.projectRows.length;
    if (rowCount === 0) {
      return;
    }

    if (this.pendingRowCount + rowCount > this.config.queueLimit) {
      this.logger.warn(
        {
          attemptedRows: rowCount,
          batchSize: this.config.batchSize,
          pendingRowCount: this.pendingRowCount,
          queueLimit: this.config.queueLimit,
        },
        "collector queue saturated",
      );
      throw new QueueLimitExceededError(
        this.config.queueLimit,
        this.pendingRowCount,
        rowCount,
        this.config.batchSize,
      );
    }

    return await new Promise<void>((resolve, reject) => {
      this.pending.push({
        rows: [...batch.defaultRows],
        projectRows: [...batch.projectRows],
        rowCount,
        resolve,
        reject,
      });
      this.pendingRowCount += rowCount;

      if (this.pendingRowCount >= this.config.batchSize) {
        void this.flushSoon();
        return;
      }

      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          void this.flushSoon();
        }, this.config.batchTimeoutMs);
      }
    });
  }

  async flush(): Promise<void> {
    if (this.pendingRowCount === 0) {
      return;
    }

    await this.flushSoon();
  }

  async runRetention(now: Date = new Date()): Promise<void> {
    const cutoff = new Date(
      now.getTime() - this.config.retentionDays * 24 * 60 * 60 * 1_000,
    ).toISOString();

    this.logger.info(
      {
        cutoff,
        retentionDays: this.config.retentionDays,
      },
      "collector retention started",
    );

    try {
      await this.executor.enqueue(async () => {
        await this.database.deleteEventsBefore(cutoff);
        await this.database.runRetentionMaintenance();
      });

      this.logger.info(
        {
          cutoff,
          retentionDays: this.config.retentionDays,
        },
        "collector retention completed",
      );
    } catch (error) {
      this.logger.error(
        {
          cutoff,
          retentionDays: this.config.retentionDays,
          err: error instanceof Error ? error : new Error(String(error)),
        },
        "collector retention failed",
      );
      throw error;
    }
  }

  async runPromotionCycle(): Promise<void> {
    await this.executor.enqueue(async () => {
      const totalRetainedRows = await readTotalRetainedRows(this.database);
      const candidates = this.catalog.selectPromotionCandidates(
        totalRetainedRows,
        this.config.promotionMinRows,
        this.config.promotionMinRatio,
        this.config.promotionMaxKeysPerRun,
      );

      for (const candidate of candidates) {
        const promoting = await this.catalog.markPromoting(
          this.database,
          candidate.key,
        );
        if (!promoting) {
          continue;
        }

        try {
          const promoted = await this.schema.ensurePromotedColumn(
            this.database,
            promoting.sanitizedKey,
            promoting.inferredType,
          );

          if (!promoted) {
            await this.catalog.markFailed(
              this.database,
              promoting.key,
              new Error("Max promoted column count reached"),
            );
            return;
          }

          await this.database.backfillPromotedColumn(
            promoting.sanitizedKey,
            promoting.inferredType,
            promoting.key,
          );
          await this.catalog.markPromoted(
            this.database,
            promoting.key,
            promoting.sanitizedKey,
            promoting.inferredType,
          );
        } catch (error) {
          await this.catalog.markFailed(this.database, candidate.key, error);
          this.logger.error(
            {
              err: error instanceof Error ? error : new Error(String(error)),
              key: candidate.key,
            },
            "collector promotion failed",
          );
        }
      }
    });
  }

  private async flushSoon(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }

    const batch = this.pending.splice(0, this.pending.length);
    if (batch.length === 0) {
      return;
    }

    const rows = batch.flatMap((entry) => entry.rows);
    const projectRows = batch.flatMap((entry) => entry.projectRows);
    const rowCount = batch.reduce((total, entry) => total + entry.rowCount, 0);
    this.pendingRowCount -= rowCount;

    try {
      await this.executor.enqueue(async () => {
        if (rows.length > 0) {
          await ensureHintedPromotions(
            this.database,
            this.schema,
            this.catalog,
            rows,
          );
          await this.catalog.recordRows(this.database, rows);
          await insertRows(this.database, this.schema, this.catalog, rows);
        }
        await insertProjectRows(this.database, this.projectSchema, projectRows);
      });

      for (const entry of batch) {
        entry.resolve();
      }
    } catch (error) {
      for (const entry of batch) {
        entry.reject(error);
      }
    }
  }
}

async function ensureHintedPromotions(
  database: CollectorDatabase,
  schema: SchemaRegistry,
  catalog: AttributeCatalog,
  rows: readonly StoredEventRow[],
): Promise<void> {
  const hintedKeys = new Set<string>();

  for (const row of rows) {
    for (const key of row.promoted_attribute_hints) {
      hintedKeys.add(key);
    }
  }

  for (const key of hintedKeys) {
    if (isBaselineColumn(key)) {
      throw new Error(`Cannot promote baseline column "${key}"`);
    }

    const existing = catalog.getEntry(key);
    if (existing?.storageState === "promoted") {
      continue;
    }

    const value = firstNonNullHintedValue(rows, key);
    if (typeof value === "undefined") {
      throw new Error(`Promotion hint "${key}" was not present in annotated attributes`);
    }

    if (!isPrimitiveEventValue(value)) {
      throw new Error(`Promotion hint "${key}" requires a primitive value`);
    }

    const inferredType = resolveHintedPromotionType(
      existing?.inferredType ?? null,
      value,
      key,
    );
    const promotedColumn = existing?.sanitizedKey ?? sanitizeIdentifier(key);
    const promoted = await schema.ensurePromotedColumn(
      database,
      promotedColumn,
      inferredType,
    );

    if (!promoted) {
      throw new Error(`Max promoted column count reached while promoting "${key}"`);
    }

    await catalog.markPromoted(database, key, promotedColumn, inferredType);
  }
}

async function insertRows(
  database: CollectorDatabase,
  schema: SchemaRegistry,
  catalog: AttributeCatalog,
  rows: readonly StoredEventRow[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const promotedColumns = catalog.getPromotedColumns();
  const promotedColumnsByName = buildPromotedColumnsByName(promotedColumns);
  const columnNames = collectInsertColumns(rows, promotedColumns);
  const insertRows: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const overflow = buildOverflowAttributes(row, promotedColumns);
    const insertRow: Record<string, unknown> = {};

    for (const column of columnNames) {
      if (column === "attributes_overflow") {
        insertRow[column] = overflow;
        continue;
      }

      if (isBaselineColumn(column)) {
        insertRow[column] = serializeRowValue(row[column]);
        continue;
      }

      const promoted = promotedColumnsByName.get(column);
      const value = promoted ? row.attributes_overflow[promoted.key] : null;
      insertRow[column] = promoted ? normalizePromotedValue(value, promoted.type) : null;
    }

    insertRows.push(insertRow);
  }

  await database.insertEventRows(columnNames, insertRows);
}

async function insertProjectRows(
  database: CollectorDatabase,
  projectSchema: ProjectSchemaRegistry,
  rows: readonly ProjectEventRow[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  await projectSchema.ensureProjectColumns(database, rows);
  const columnNames = collectProjectInsertColumns(rows);
  const insertRows: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const insertRow: Record<string, unknown> = {};

    for (const column of columnNames) {
      if (column === "project_fields" || column === "project_field_types") {
        insertRow[column] = row[column];
        continue;
      }

      if (isProjectEventColumn(column)) {
        insertRow[column] = serializeRowValue(row[column]);
        continue;
      }

      const projectField = findProjectField(row, column);
      const type = projectField?.type;
      const value = projectField?.value;
      insertRow[column] = normalizeTypedColumnValue(value, type);
    }

    insertRows.push(insertRow);
  }

  await database.insertProjectEventRows(columnNames, insertRows);
}

function collectProjectInsertColumns(rows: readonly ProjectEventRow[]): string[] {
  const columnSet = new Set<string>(PROJECT_EVENT_COLUMN_NAMES);
  for (const row of rows) {
    for (const field of Object.keys(row.project_field_types)) {
      columnSet.add(sanitizeIdentifier(field));
    }
  }
  return [...columnSet].sort();
}

function isProjectEventColumn(column: string): column is ProjectEventColumnName {
  return PROJECT_EVENT_COLUMN_SET.has(column);
}

function findProjectField(
  row: ProjectEventRow,
  column: string,
): { type: string; value: unknown } | null {
  for (const [field, type] of Object.entries(row.project_field_types)) {
    if (sanitizeIdentifier(field) === column) {
      return {
        type,
        value: row.project_fields[field],
      };
    }
  }
  return null;
}

function collectInsertColumns(
  rows: readonly StoredEventRow[],
  promotedColumns: Map<string, { column: string; type: string }>,
): string[] {
  const columnSet = new Set<string>(BASELINE_COLUMN_NAMES);
  for (const row of rows) {
    columnSet.add("attributes_overflow");
    for (const [key, promoted] of promotedColumns.entries()) {
      if (key in row.attributes_overflow) {
        columnSet.add(promoted.column);
      }
    }
  }

  return [...columnSet].sort();
}

function serializeRowValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "undefined") {
    return null;
  }

  return JSON.stringify(value);
}

function normalizeTypedColumnValue(value: unknown, type: string | undefined): unknown {
  if (!type) {
    return null;
  }

  if (type === "JSON") {
    if (value === null || typeof value === "undefined") {
      return null;
    }
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  return normalizePromotedValue(value, type);
}

async function readTotalRetainedRows(
  database: CollectorDatabase,
): Promise<number> {
  return await database.countEvents();
}

function buildOverflowAttributes(
  row: StoredEventRow,
  promotedColumns: Map<string, { column: string; type: string }>,
): Record<string, unknown> {
  let needsFiltering = false;

  for (const key of Object.keys(row.attributes_overflow)) {
    if (promotedColumns.has(key)) {
      needsFiltering = true;
      break;
    }
  }

  if (!needsFiltering) {
    return row.attributes_overflow;
  }

  const overflow: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row.attributes_overflow)) {
    if (promotedColumns.has(key)) {
      continue;
    }

    overflow[key] = value;
  }

  return overflow;
}

function firstNonNullHintedValue(
  rows: readonly StoredEventRow[],
  key: string,
): EventPrimitive | undefined {
  let sawKey = false;

  for (const row of rows) {
    if (!(key in row.attributes_overflow)) {
      continue;
    }

    sawKey = true;
    const value = row.attributes_overflow[key];
    if (value !== null) {
      return isPrimitiveEventValue(value) ? value : null;
    }
  }

  return sawKey ? null : undefined;
}

function resolveHintedPromotionType(
  existingType: InferredAttributeType | null,
  value: EventPrimitive,
  key: string,
): InferredAttributeType {
  const nextType = inferValueType(value);
  const inferredType = existingType
    ? mergeInferredType(existingType, nextType)
    : nextType;

  if (inferredType === "JSON") {
    throw new Error(`Promotion hint "${key}" requires a primitive value`);
  }

  return inferredType;
}

function buildPromotedColumnsByName(
  promotedColumns: Map<string, { column: string; type: string }>,
): Map<string, { key: string; type: string }> {
  const promotedColumnsByName = new Map<string, { key: string; type: string }>();

  for (const [key, entry] of promotedColumns.entries()) {
    promotedColumnsByName.set(entry.column, { key, type: entry.type });
  }

  return promotedColumnsByName;
}

function normalizePromotedValue(value: unknown, type: string): unknown {
  if (value === null || typeof value === "undefined") {
    return null;
  }

  switch (type) {
    case "BOOLEAN":
      if (typeof value === "boolean") {
        return value;
      }
      if (typeof value === "string") {
        if (value === "true") {
          return true;
        }
        if (value === "false") {
          return false;
        }
      }
      return null;
    case "BIGINT":
      if (typeof value === "number" && Number.isInteger(value)) {
        return value;
      }
      if (typeof value === "string") {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    case "DOUBLE":
      if (typeof value === "number") {
        return value;
      }
      if (typeof value === "string") {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    case "VARCHAR":
      return typeof value === "string" ? value : JSON.stringify(value);
    default:
      return null;
  }
}
