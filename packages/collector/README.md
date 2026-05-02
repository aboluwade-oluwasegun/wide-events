# @wide-events/collector

Collector service and CLI for ingesting native wide events and querying DuckDB-backed observability data.

## Run

```bash
WIDE_EVENTS_DUCKDB_PATH=./wide-events.db npx wide-events-collector
```

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

## Query

### `POST /query`

Structured queries target baseline and promoted columns:

```json
{
  "select": [{ "fn": "P95", "field": "duration_ms", "as": "p95_ms" }],
  "filters": [{ "field": "service.name", "op": "eq", "value": "orders-api" }],
  "groupBy": ["http.route"]
}
```

`scope` defaults to `"main"`, which applies `main = true`. Set `scope: "all"` to query all stored events.

### `POST /sql`

Runs read-only SQL for advanced inspection, including overflow JSON:

```sql
SELECT map_extract_value(attributes_overflow, 'db.queries') FROM events;
```

### `GET /events/:correlationId`

Returns all events for a correlation id in timestamp order.

### `GET /columns`

Lists baseline, overflow-only, promoted, and failed columns.

## Configuration

Required:

- `WIDE_EVENTS_DUCKDB_PATH`

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
