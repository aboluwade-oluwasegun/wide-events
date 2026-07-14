import { z } from "zod";

const collectorProjectConfigSchema = z
  .object({
    projectId: z.string().min(1),
    serviceName: z.string().min(1).nullable().default(null),
    environment: z.string().min(1).nullable().default(null),
    active: z.boolean().default(true),
    ruleVersion: z.string().min(1).default("1")
  })
  .strict();

const commonCollectorConfigSchema = z.object({
  port: z.number().int().positive().default(4318),
  batchSize: z.number().int().positive().default(100),
  batchTimeoutMs: z.number().int().positive().default(1_000),
  retentionDays: z.number().int().positive().default(30),
  maxPromotedColumns: z.number().int().positive().default(200),
  promotionIntervalMs: z.number().int().positive().default(300_000),
  promotionMinRows: z.number().int().positive().default(1_000),
  promotionMinRatio: z.number().positive().default(0.01),
  promotionMaxKeysPerRun: z.number().int().positive().default(1),
  queueLimit: z.number().int().positive().default(10_000),
  projectConfigTtlSeconds: z.number().int().positive().default(60),
  projects: z.array(collectorProjectConfigSchema).default([])
});

const clickHouseConfigSchema = z.object({
  url: z.url(),
  database: z.string().min(1),
  username: z.string().min(1).default("default"),
  password: z.string().optional()
});

export const collectorConfigSchema = z.discriminatedUnion("storage", [
  commonCollectorConfigSchema.extend({
    storage: z.literal("duckdb"),
    duckDbPath: z.string().min(1)
  }),
  commonCollectorConfigSchema.extend({
    storage: z.literal("clickhouse"),
    duckDbPath: z.string().min(1).optional(),
    clickHouse: clickHouseConfigSchema
  })
]);

export type CollectorConfig = z.infer<typeof collectorConfigSchema>;

export function readCollectorConfig(
  env: NodeJS.ProcessEnv = process.env
): CollectorConfig {
  return collectorConfigSchema.parse({
    storage: env["WIDE_EVENTS_STORAGE"] ?? "duckdb",
    duckDbPath: env["WIDE_EVENTS_DUCKDB_PATH"],
    clickHouse: {
      url: env["WIDE_EVENTS_CLICKHOUSE_URL"],
      database: env["WIDE_EVENTS_CLICKHOUSE_DATABASE"],
      username: env["WIDE_EVENTS_CLICKHOUSE_USERNAME"] ?? "default",
      password: env["WIDE_EVENTS_CLICKHOUSE_PASSWORD"]
    },
    port: parseInteger("WIDE_EVENTS_COLLECTOR_PORT", env["WIDE_EVENTS_COLLECTOR_PORT"], 4318),
    batchSize: parseInteger("WIDE_EVENTS_BATCH_SIZE", env["WIDE_EVENTS_BATCH_SIZE"], 100),
    batchTimeoutMs: parseInteger(
      "WIDE_EVENTS_BATCH_TIMEOUT_MS",
      env["WIDE_EVENTS_BATCH_TIMEOUT_MS"],
      1_000,
    ),
    retentionDays: parseInteger("WIDE_EVENTS_RETENTION_DAYS", env["WIDE_EVENTS_RETENTION_DAYS"], 30),
    maxPromotedColumns: parseInteger(
      "WIDE_EVENTS_MAX_PROMOTED_COLUMNS",
      env["WIDE_EVENTS_MAX_PROMOTED_COLUMNS"],
      200,
    ),
    promotionIntervalMs: parseInteger(
      "WIDE_EVENTS_PROMOTION_INTERVAL_MS",
      env["WIDE_EVENTS_PROMOTION_INTERVAL_MS"],
      300_000
    ),
    promotionMinRows: parseInteger(
      "WIDE_EVENTS_PROMOTION_MIN_ROWS",
      env["WIDE_EVENTS_PROMOTION_MIN_ROWS"],
      1_000,
    ),
    promotionMinRatio: parseNumber(
      "WIDE_EVENTS_PROMOTION_MIN_RATIO",
      env["WIDE_EVENTS_PROMOTION_MIN_RATIO"],
      0.01,
    ),
    promotionMaxKeysPerRun: parseInteger(
      "WIDE_EVENTS_PROMOTION_MAX_KEYS_PER_RUN",
      env["WIDE_EVENTS_PROMOTION_MAX_KEYS_PER_RUN"],
      1
    ),
    queueLimit: parseInteger("WIDE_EVENTS_QUEUE_LIMIT", env["WIDE_EVENTS_QUEUE_LIMIT"], 10_000),
    projectConfigTtlSeconds: parseInteger(
      "WIDE_EVENTS_PROJECT_CONFIG_TTL_SECONDS",
      env["WIDE_EVENTS_PROJECT_CONFIG_TTL_SECONDS"],
      60
    ),
    projects: parseProjectConfigs(env["WIDE_EVENTS_PROJECTS"])
  });
}

function parseProjectConfigs(value: string | undefined): unknown {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(
      `WIDE_EVENTS_PROJECTS must be valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

function parseInteger(name: string, value: string | undefined, fallback: number): number {
  if (typeof value === "undefined") {
    return fallback;
  }

  const parsed = parseFullNumber(name, value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  return parsed;
}

function parseNumber(name: string, value: string | undefined, fallback: number): number {
  if (typeof value === "undefined") {
    return fallback;
  }

  return parseFullNumber(name, value);
}

function parseFullNumber(name: string, value: string): number {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${name} must be a number`);
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  return parsed;
}
