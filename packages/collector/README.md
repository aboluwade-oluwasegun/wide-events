# @wide-events/collector

Collector service and CLI for ingesting native wide events and querying observability data. DuckDB is the default storage backend; ClickHouse can be enabled for production deployments that need a server-side analytical database.

## Run

```bash
WIDE_EVENTS_DUCKDB_PATH=./wide-events.db npx wide-events-collector
```

Run with ClickHouse:

```bash
WIDE_EVENTS_STORAGE=clickhouse \
WIDE_EVENTS_CLICKHOUSE_URL=http://localhost:8123 \
WIDE_EVENTS_CLICKHOUSE_DATABASE=wide_events \
npx wide-events-collector
```

The collector creates the ClickHouse database and tables on startup.

## Ingest

### `POST /v1/events`

Accepts native structured event JSON:

```json
{
  "events": [
    {
      "event_id": "event-1",
      "correlation_id": "corr-1",
      "ts": "2026-05-02T00:00:00.000Z",
      "duration_ms": 42,
      "main": true,
      "sample_rate": 1,
      "service.name": "orders-api",
      "http.route": "/orders",
      "http.status_code": 201,
      "attributes": {
        "order.total": 99.5,
        "db.queries": [{ "operation": "select_order", "duration_ms": 12 }]
      },
      "promote": ["order.total"]
    }
  ]
}
```

Known baseline fields are stored as typed columns. Unknown fields and `attributes` entries land in `attributes_overflow`. Primitive fields listed in `promote` are promoted into typed columns.

Project-scoped events include `project_id`, `project_fields`, and `project_field_types`.
The collector accepts them only when `project_id` is registered and active in `WIDE_EVENTS_PROJECTS`; accepted project events are stored in `project_events`, separate from the default `events` table.

Project events do not use the default promotion/catalog path. On ingest, the collector reads `project_field_types`, adds missing typed columns to `project_events`, and writes each `project_fields` entry into the matching typed column. Default events without project metadata continue to route only to `events`.

### `GET /v1/projects/config`

Returns active project routing config for SDK refresh flows:

```bash
curl "http://localhost:4318/v1/projects/config?serviceName=orders-api&serviceEnvironment=prod"
```

This is a read-only config endpoint. The collector does not provide project create, update, or delete APIs in v1; define project registry entries with `WIDE_EVENTS_PROJECTS` when the collector starts.

## Query

### `POST /query`

Structured queries target default events unless `source` is set:

```json
{
  "select": [{ "fn": "P95", "field": "duration_ms", "as": "p95_ms" }],
  "filters": [{ "field": "service.name", "op": "eq", "value": "orders-api" }],
  "groupBy": ["http.route"]
}
```

`scope` defaults to `"main"`, which applies `main = true`. Set `scope: "all"` to query all stored events.

Use `source: "project_events"` to query project-scoped events and their typed project field columns:

```json
{
  "source": "project_events",
  "select": [{ "fn": "SUM", "field": "order.total", "as": "total" }],
  "filters": [{ "field": "project_id", "op": "eq", "value": "project_checkout" }],
  "groupBy": ["project_id"],
  "scope": "all"
}
```

Project queries are validated against the actual `project_events` table columns. Unknown project fields are rejected until they have been observed and added during project-event ingest.

### `POST /sql`

Runs read-only SQL for advanced inspection, including overflow JSON:

```sql
SELECT map_extract_value(attributes_overflow, 'db.queries') FROM events;
```

### `GET /events/:correlationId`

Returns all events for a correlation id in timestamp order.

### `GET /columns`

Lists baseline, overflow-only, promoted, and failed columns.

Use `GET /columns?source=project_events` to list queryable project event columns, including typed project fields observed during ingest.

## Configuration

Storage:

- `WIDE_EVENTS_STORAGE`: `duckdb` by default; set to `clickhouse` for ClickHouse.

DuckDB storage:

- `WIDE_EVENTS_DUCKDB_PATH`

ClickHouse storage:

- `WIDE_EVENTS_CLICKHOUSE_URL`
- `WIDE_EVENTS_CLICKHOUSE_DATABASE`
- `WIDE_EVENTS_CLICKHOUSE_USERNAME`: default `default`
- `WIDE_EVENTS_CLICKHOUSE_PASSWORD`: optional

Optional:

- `WIDE_EVENTS_COLLECTOR_PORT`: default `4318`
- `WIDE_EVENTS_BATCH_SIZE`: default `100`
- `WIDE_EVENTS_BATCH_TIMEOUT_MS`: default `1000`
- `WIDE_EVENTS_RETENTION_DAYS`: default `30`
- `WIDE_EVENTS_MAX_PROMOTED_COLUMNS`: default `200`
- `WIDE_EVENTS_PROMOTION_INTERVAL_MS`: default `300000`
- `WIDE_EVENTS_PROMOTION_MIN_ROWS`: default `1000`
- `WIDE_EVENTS_PROMOTION_MIN_RATIO`: default `0.01`
- `WIDE_EVENTS_PROMOTION_MAX_KEYS_PER_RUN`: default `25`
- `WIDE_EVENTS_QUEUE_LIMIT`: default `10000`
- `WIDE_EVENTS_PROJECT_CONFIG_TTL_SECONDS`: default `60`
- `WIDE_EVENTS_PROJECTS`: JSON array of project registry entries. Example:

```json
[
  {
    "projectId": "project_checkout",
    "serviceName": "orders-api",
    "environment": "prod",
    "ruleVersion": "2026-07-01",
    "active": true
  }
]
```

Project registry fields:

- `projectId`: required stable project identifier; incoming `project_id` must match one active entry.
- `serviceName`: optional service constraint. Use `null` to accept any service.
- `environment`: optional environment constraint. Use `null` to accept any environment.
- `ruleVersion`: fallback `project_rule_version` when an incoming project event omits one.
- `active`: set `false` to keep a project configured but reject new project events.
