import type { CollectorConfig } from "../config.js";
import { ClickHouseDatabase } from "./clickhouse.js";
import { DuckDbDatabase } from "./duckdb.js";
import type { CollectorDatabase } from "./types.js";

export async function createCollectorDatabase(
  config: CollectorConfig,
): Promise<CollectorDatabase> {
  switch (config.storage) {
    case "duckdb":
      return await DuckDbDatabase.create(config.duckDbPath);
    case "clickhouse":
      return await ClickHouseDatabase.create(config);
    default:
      return assertNever(config);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported collector storage config: ${String(value)}`);
}
