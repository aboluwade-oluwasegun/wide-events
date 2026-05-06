export type EventPrimitive = string | number | boolean | null;

export type EventValue =
  | EventPrimitive
  | EventValue[]
  | {
      [key: string]: EventValue;
    };

export type DynamicEventAttributes = Record<string, EventValue>;

export interface StoredEventRow {
  event_id: string;
  correlation_id: string;
  parent_event_id: string | null;
  ts: string;
  duration_ms: number | null;
  main: boolean;
  sample_rate: number;
  "service.name": string | null;
  "service.environment": string | null;
  "service.version": string | null;
  "http.route": string | null;
  "http.status_code": number | null;
  "http.request.method": string | null;
  error: boolean | null;
  "exception.slug": string | null;
  "user.id": string | null;
  "user.type": string | null;
  "user.org.id": string | null;
  attributes_overflow: DynamicEventAttributes;
  promoted_attribute_hints: string[];
}

export interface WideEvent {
  event_id?: string | undefined;
  correlation_id?: string | undefined;
  parent_event_id?: string | null | undefined;
  ts?: string | undefined;
  duration_ms?: number | null | undefined;
  main?: boolean | undefined;
  sample_rate?: number | undefined;
  name?: string | undefined;
  type?: string | undefined;
  "service.name"?: string | null | undefined;
  "service.environment"?: string | null | undefined;
  "service.version"?: string | null | undefined;
  "http.route"?: string | null | undefined;
  "http.status_code"?: number | null | undefined;
  "http.request.method"?: string | null | undefined;
  error?: boolean | null | undefined;
  "exception.slug"?: string | null | undefined;
  "user.id"?: string | null | undefined;
  "user.type"?: string | null | undefined;
  "user.org.id"?: string | null | undefined;
  attributes?: DynamicEventAttributes | undefined;
  promote?: string[] | undefined;
}

export interface WideEventBatch {
  events: WideEvent[];
}

export type QueryAggregateFunction =
  | "COUNT"
  | "SUM"
  | "AVG"
  | "MIN"
  | "MAX"
  | "P50"
  | "P95"
  | "P99";

export interface QuerySelectItem {
  fn: QueryAggregateFunction;
  field?: string | undefined;
  as?: string | undefined;
}

export type QueryFilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in";

export interface QueryFilter {
  field: string;
  op: QueryFilterOperator;
  value: EventPrimitive | readonly EventPrimitive[];
}

export interface QueryTimeRange {
  last: string;
}

export interface QueryOrderBy {
  field: string;
  dir: "asc" | "desc";
}

export type QueryScope = "main" | "all";

export interface StructuredQuery {
  select: readonly QuerySelectItem[];
  filters?: readonly QueryFilter[] | undefined;
  groupBy?: readonly string[] | undefined;
  timeRange?: QueryTimeRange | undefined;
  orderBy?: QueryOrderBy | undefined;
  limit?: number | undefined;
  scope?: QueryScope | undefined;
}

export type QueryRow = Record<string, EventValue>;

export interface QueryResult {
  rows: QueryRow[];
}

export interface ColumnInfo {
  name: string;
  storageState: "baseline" | "overflow_only" | "promoted" | "failed";
  queryable: boolean;
  inferredType: string | null;
  promotedType: string | null;
  seenRows: number;
  lastSeenAt: string | null;
}

export interface EventsResult {
  correlationId: string;
  rows: QueryRow[];
}

export type PromotionStorageState =
  | "overflow_only"
  | "promoting"
  | "promoted"
  | "failed";

export type InferredAttributeType =
  | "BOOLEAN"
  | "BIGINT"
  | "DOUBLE"
  | "VARCHAR"
  | "JSON";

export interface AttributeCatalogEntry {
  key: string;
  sanitizedKey: string;
  storageState: PromotionStorageState;
  inferredType: InferredAttributeType;
  seenRows: number;
  nonNullRows: number;
  firstSeenAt: string;
  lastSeenAt: string;
  promotedColumn: string | null;
  promotedType: InferredAttributeType | null;
  promotedAt: string | null;
  lastError: string | null;
}
