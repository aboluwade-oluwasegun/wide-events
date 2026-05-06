import { z } from "zod";
import type { WideEventSink } from "./core";

const autoInstrumentSchema = z
  .object({
    fetch: z.boolean().default(false)
  })
  .default({
    fetch: false
  });

export const nodeOptionsSchema = z.object({
  serviceName: z.string().min(1),
  environment: z.string().default("development"),
  collectorUrl: z.url().optional(),
  sampleRate: z.number().int().positive().default(1),
  disabled: z.boolean().default(false),
  batchSize: z.number().int().positive().default(100),
  autoInstrument: autoInstrumentSchema
});

export interface WideEventsOptions extends z.input<typeof nodeOptionsSchema> {
  fetchImpl?: typeof fetch | undefined;
  sink?: WideEventSink | undefined;
}

export interface ResolvedWideEventsOptions extends z.output<typeof nodeOptionsSchema> {
  fetchImpl?: typeof fetch | undefined;
  sink?: WideEventSink | undefined;
}

export const edgeOptionsSchema = z.object({
  serviceName: z.string().min(1),
  environment: z.string().default("development"),
  collectorUrl: z.url().optional(),
  sampleRate: z.number().int().positive().default(1),
  disabled: z.boolean().default(false),
  batchSize: z.number().int().positive().default(100),
  autoInstrument: autoInstrumentSchema
});

export interface EdgeWideEventsOptions extends z.input<typeof edgeOptionsSchema> {
  fetchImpl?: typeof fetch | undefined;
  sink?: WideEventSink | undefined;
}

export interface ResolvedEdgeWideEventsOptions extends z.output<typeof edgeOptionsSchema> {
  fetchImpl?: typeof fetch | undefined;
  sink?: WideEventSink | undefined;
}

export function resolveNodeOptions(options: WideEventsOptions): ResolvedWideEventsOptions {
  return {
    ...nodeOptionsSchema.parse(options),
    fetchImpl: options.fetchImpl,
    sink: options.sink
  };
}
