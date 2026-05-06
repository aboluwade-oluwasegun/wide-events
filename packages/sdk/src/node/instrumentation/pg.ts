import type { Pool, PoolClient } from "pg";
import type { InstrumentationHooks } from "../../shared/instrumentation/types.js";

type PgQueryResultLike = { rowCount?: number | null } | null | undefined;

export type PgPoolTarget = Pool | PoolClient;

const patchedPools = new WeakSet<PgPoolTarget>();

const DEFAULT_SQL_TRUNCATE = 200;

export interface PgInstrumentationOptions {
  /** Max UTF-16 code units of SQL snippet stored per row (default 200). */
  sqlTruncateLength?: number;
}

function truncateSql(sql: unknown, maxLen: number): string | null {
  if (sql === null || typeof sql === "undefined") {
    return null;
  }
  if (typeof sql === "string") {
    return finalize(sql, maxLen);
  }
  if (typeof sql === "object" && sql !== null && "text" in sql && typeof (sql as { text: unknown }).text === "string") {
    return finalize((sql as { text: string }).text, maxLen);
  }
  if (
    typeof sql === "number" ||
    typeof sql === "boolean" ||
    typeof sql === "bigint" ||
    typeof sql === "symbol"
  ) {
    return finalize(String(sql), maxLen);
  }
  return null;
}

function finalize(s: string, maxLen: number): string | null {
  const t = s.trim();
  if (t === "") return null;
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
}

function extractSqlSnippet(firstArg: unknown, maxSqlLength: number): string | null {
  if (typeof firstArg === "string") {
    return truncateSql(firstArg, maxSqlLength);
  }
  if (typeof firstArg === "object" && firstArg !== null && "text" in firstArg) {
    return truncateSql((firstArg as { text?: unknown }).text, maxSqlLength);
  }
  return truncateSql(firstArg, maxSqlLength);
}

function extractRowCount(result: unknown): number | null {
  const candidate = result as PgQueryResultLike;
  return typeof candidate?.rowCount === "number" ? candidate.rowCount : null;
}

/**
 * Wrap `pool.query` once to push `db.queries` / `db.errors` into the active wide event.
 *
 * Install once per pool at process startup — calling twice is a no-op.
 */
export function instrumentPg(
  pool: PgPoolTarget,
  hooks: InstrumentationHooks,
  options: PgInstrumentationOptions = {},
): void {
  const maxSql = options.sqlTruncateLength ?? DEFAULT_SQL_TRUNCATE;
  if (patchedPools.has(pool)) {
    return;
  }
  patchedPools.add(pool);

  const original = pool.query.bind(pool);

  pool.query = (async (...args: unknown[]): Promise<unknown> => {
    const startedAt = performance.now();
    const sql = extractSqlSnippet(args[0], maxSql);

    try {
      const result: unknown = await Reflect.apply(original, pool, args);
      hooks.push("db.queries", {
        sql,
        duration_ms: performance.now() - startedAt,
        row_count: extractRowCount(result),
      });
      return result;
    } catch (error: unknown) {
      hooks.push("db.errors", {
        sql,
        duration_ms: performance.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      hooks.recordError(error, { slug: "pg_query_failed", handled: false });
      throw error;
    }
  }) as typeof pool.query;
}
