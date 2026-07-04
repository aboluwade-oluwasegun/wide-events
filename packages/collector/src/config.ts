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
    port: parseInteger(env["WIDE_EVENTS_COLLECTOR_PORT"], 4318),
    batchSize: parseInteger(env["WIDE_EVENTS_BATCH_SIZE"], 100),
    batchTimeoutMs: parseInteger(env["WIDE_EVENTS_BATCH_TIMEOUT_MS"], 1_000),
    retentionDays: parseInteger(env["WIDE_EVENTS_RETENTION_DAYS"], 30),
    maxPromotedColumns: parseInteger(env["WIDE_EVENTS_MAX_PROMOTED_COLUMNS"], 200),
    promotionIntervalMs: parseInteger(
      env["WIDE_EVENTS_PROMOTION_INTERVAL_MS"],
      300_000
    ),
    promotionMinRows: parseInteger(env["WIDE_EVENTS_PROMOTION_MIN_ROWS"], 1_000),
    promotionMinRatio: parseNumber(env["WIDE_EVENTS_PROMOTION_MIN_RATIO"], 0.01),
    promotionMaxKeysPerRun: parseInteger(
      env["WIDE_EVENTS_PROMOTION_MAX_KEYS_PER_RUN"],
      1
    ),
    queueLimit: parseInteger(env["WIDE_EVENTS_QUEUE_LIMIT"], 10_000),
    projectConfigTtlSeconds: parseInteger(
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

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
