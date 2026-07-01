import type { ClickHouseClientConfigOptions } from "@clickhouse/client";
import type { CollectorConfig } from "../../config.js";

export interface ClickHouseCommandClient {
  command(params: {
    query: string;
    query_params?: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface ClickHouseClientHandle extends ClickHouseCommandClient {
  close(): Promise<void>;
  ping(): Promise<{ success: boolean; error?: Error }>;
}

export interface ClickHouseResultSet {
  json(): Promise<unknown[]>;
}

export interface ClickHouseStorageClient extends ClickHouseClientHandle {
  insert(params: {
    columns: [string, ...string[]];
    format: "JSONCompactEachRow";
    table: string;
    values: readonly unknown[][];
  }): Promise<unknown>;
  query(params: {
    format: "JSONEachRow";
    query: string;
    query_params?: Record<string, unknown>;
  }): Promise<ClickHouseResultSet>;
}

export type ClickHouseStorageClientFactory = (
  options: ClickHouseClientConfigOptions,
) => ClickHouseStorageClient;

export function toClickHouseClientOptions(
  config: Extract<CollectorConfig, { storage: "clickhouse" }>,
): ClickHouseClientConfigOptions {
  const options: ClickHouseClientConfigOptions = {
    url: config.clickHouse.url,
    database: config.clickHouse.database,
    username: config.clickHouse.username,
    application: "wide-events-collector",
  };

  if (config.clickHouse.password) {
    options.password = config.clickHouse.password;
  }

  return options;
}
