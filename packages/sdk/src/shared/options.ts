import { z } from "zod";
import type { WideEventSink } from "./core.js";
import { DEFAULT_PROJECT_RULE_REFRESH_INTERVAL_MS } from "./project-rules.js";

const autoInstrumentSchema = z
  .object({
    fetch: z.boolean().default(false)
  })
  .default({
    fetch: false
  });

const projectsSchema = z
  .union([
    z.literal(false),
    z
      .object({
        ids: z.array(z.string().trim().min(1)).min(1).optional(),
        refreshIntervalMs: z
          .number()
          .int()
          .positive()
          .default(DEFAULT_PROJECT_RULE_REFRESH_INTERVAL_MS)
      })
      .strict()
  ])
  .default(false);

export const nodeOptionsSchema = z
  .object({
    serviceName: z.string().min(1),
    environment: z.string().default("development"),
    collectorUrl: z.url().optional(),
    apiKey: z.string().min(1).optional(),
    apiUrl: z.url().optional(),
    sampleRate: z.number().int().positive().default(1),
    disabled: z.boolean().default(false),
    batchSize: z.number().int().positive().default(100),
    projects: projectsSchema,
    autoInstrument: autoInstrumentSchema
  })
  .strict();

export interface WideEventsOptions extends z.input<typeof nodeOptionsSchema> {
  fetchImpl?: typeof fetch | undefined;
  sink?: WideEventSink | undefined;
}

export interface ResolvedWideEventsOptions extends z.output<typeof nodeOptionsSchema> {
  fetchImpl?: typeof fetch | undefined;
  sink?: WideEventSink | undefined;
}

export const edgeOptionsSchema = z
  .object({
    serviceName: z.string().min(1),
    environment: z.string().default("development"),
    collectorUrl: z.url().optional(),
    apiKey: z.string().min(1).optional(),
    apiUrl: z.url().optional(),
    sampleRate: z.number().int().positive().default(1),
    disabled: z.boolean().default(false),
    batchSize: z.number().int().positive().default(100),
    projects: projectsSchema,
    autoInstrument: autoInstrumentSchema
  })
  .strict();

export interface EdgeWideEventsOptions extends z.input<typeof edgeOptionsSchema> {
  fetchImpl?: typeof fetch | undefined;
  sink?: WideEventSink | undefined;
}

export interface ResolvedEdgeWideEventsOptions extends z.output<typeof edgeOptionsSchema> {
  fetchImpl?: typeof fetch | undefined;
  sink?: WideEventSink | undefined;
}

export function resolveNodeOptions(options: WideEventsOptions): ResolvedWideEventsOptions {
  const { fetchImpl, sink, ...schemaOptions } = options;

  return {
    ...nodeOptionsSchema.parse(schemaOptions),
    fetchImpl,
    sink
  };
}

export function resolveEdgeOptions(options: EdgeWideEventsOptions): ResolvedEdgeWideEventsOptions {
  const { fetchImpl, sink, ...schemaOptions } = options;

  return {
    ...edgeOptionsSchema.parse(schemaOptions),
    fetchImpl,
    sink
  };
}
