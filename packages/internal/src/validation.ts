import { z } from "zod";

const durationWindowPattern = /^(\d+)(ms|s|m|h|d)$/u;

export const eventPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null()
]);

export type EventPrimitiveInput = z.input<typeof eventPrimitiveSchema>;

export type EventValueInput =
  | EventPrimitiveInput
  | EventValueInput[]
  | { [key: string]: EventValueInput };

export const eventValueSchema: z.ZodType<EventValueInput> = z.lazy(() =>
  z.union([
    eventPrimitiveSchema,
    z.array(eventValueSchema),
    z.record(z.string(), eventValueSchema)
  ])
);

export const eventAttributesSchema = z.record(z.string().min(1), eventValueSchema);

export const wideEventSchema = z
  .object({
    event_id: z.string().min(1).optional(),
    correlation_id: z.string().min(1).optional(),
    parent_event_id: z.string().min(1).nullable().optional(),
    ts: z.iso.datetime({ offset: true }).optional(),
    duration_ms: z.number().nonnegative().nullable().optional(),
    main: z.boolean().optional(),
    sample_rate: z.number().int().positive().optional(),
    name: z.string().min(1).optional(),
    type: z.string().min(1).optional(),
    "service.name": z.string().min(1).nullable().optional(),
    "service.environment": z.string().min(1).nullable().optional(),
    "service.version": z.string().min(1).nullable().optional(),
    "http.route": z.string().min(1).nullable().optional(),
    "http.status_code": z.number().int().nullable().optional(),
    "http.request.method": z.string().min(1).nullable().optional(),
    error: z.boolean().nullable().optional(),
    "exception.slug": z.string().min(1).nullable().optional(),
    "user.id": z.string().min(1).nullable().optional(),
    "user.type": z.string().min(1).nullable().optional(),
    "user.org.id": z.string().min(1).nullable().optional(),
    attributes: eventAttributesSchema.optional(),
    promote: z.array(z.string().min(1)).optional()
  })
  .catchall(eventValueSchema);

export const wideEventBatchSchema = z
  .object({
    events: z.array(wideEventSchema).min(1)
  })
  .strict();

const countSelectSchema = z
  .object({
    fn: z.literal("COUNT"),
    as: z.string().min(1).optional()
  })
  .strict();

const fieldSelectSchema = z
  .object({
    fn: z.enum(["SUM", "AVG", "MIN", "MAX", "P50", "P95", "P99"]),
    field: z.string().min(1),
    as: z.string().min(1).optional()
  })
  .strict();

export const querySelectItemSchema = z.union([
  countSelectSchema,
  fieldSelectSchema
]);

const scalarFilterSchema = z
  .object({
    field: z.string().min(1),
    op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
    value: eventPrimitiveSchema
  })
  .strict();

const inFilterSchema = z
  .object({
    field: z.string().min(1),
    op: z.literal("in"),
    value: z.array(eventPrimitiveSchema).min(1)
  })
  .strict();

export const queryFilterSchema = z.union([
  scalarFilterSchema,
  inFilterSchema
]);

export const queryOrderBySchema = z
  .object({
    field: z.string().min(1),
    dir: z.enum(["asc", "desc"])
  })
  .strict();

export const queryTimeRangeSchema = z
  .object({
    last: z.string().regex(durationWindowPattern)
  })
  .strict();

export const structuredQuerySchema = z
  .object({
    select: z.array(querySelectItemSchema).min(1),
    filters: z.array(queryFilterSchema).optional(),
    groupBy: z.array(z.string().min(1)).optional(),
    timeRange: queryTimeRangeSchema.optional(),
    orderBy: queryOrderBySchema.optional(),
    limit: z.number().int().positive().optional(),
    scope: z.enum(["main", "all"]).optional()
  })
  .strict();

export const sqlRequestSchema = z
  .object({
    sql: z.string().min(1)
  })
  .strict();

export const eventsParamsSchema = z
  .object({
    correlationId: z.string().min(1)
  })
  .strict();
