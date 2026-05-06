/**
 * Optional Postgres example — wired only when `DATABASE_URL` is set.
 *
 * See [README.md](../README.md) for compose-based local databases.
 */
import { Pool } from "pg";
import type { InstrumentationHooks } from "@wide-events/sdk";
import { instrumentPg } from "@wide-events/sdk/instrumentation/pg";

export interface PgHealthExampleOptions {
  connectionString?: string;
}

/** Returns connection wrapper or `undefined` when skipped. */
export function createPgHealthExample(
  hooks: InstrumentationHooks,
  options: PgHealthExampleOptions = {},
): PgExampleResult | undefined {
  const connectionString =
    options.connectionString ?? process.env["DATABASE_URL"] ?? "";

  if (connectionString === "") {
    return undefined;
  }

  const pool = new Pool({
    connectionString,
  });

  instrumentPg(pool, hooks);

  return {
    pool,
    async ping(): Promise<string> {
      await pool.query("SELECT 1");
      return "ok";
    },

    async end(): Promise<void> {
      await pool.end();
    },
  };
}

interface PgExampleResult {
  pool: Pool;
  ping(): Promise<string>;
  end(): Promise<void>;
}
