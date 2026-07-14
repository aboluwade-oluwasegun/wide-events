# @wide-events/collector

Collector service and CLI for ingesting native wide events and querying observability data. DuckDB is the default storage backend; ClickHouse is optional for deployments that need a server-side analytical database.

## Run

```bash
WIDE_EVENTS_DUCKDB_PATH=./wide-events.db npx --package @wide-events/collector wide-events-collector
```

The collector listens on `http://localhost:4318` by default.

Run with the published Docker image:

```bash
docker pull oluwasegun7/wide-events-collector:1.0.0

docker run --rm \
  -e WIDE_EVENTS_DUCKDB_PATH=/data/wide-events.db \
  -v "$(pwd)/wide-events-data:/data" \
  -p 4318:4318 \
  oluwasegun7/wide-events-collector:1.0.0
```

Run with ClickHouse:

```bash
WIDE_EVENTS_STORAGE=clickhouse \
WIDE_EVENTS_CLICKHOUSE_URL=http://localhost:8123 \
WIDE_EVENTS_CLICKHOUSE_DATABASE=wide_events \
npx --package @wide-events/collector wide-events-collector
```

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/events` | Ingest native structured event batches. |
| `POST /query` | Run structured aggregate queries. |
| `POST /sql` | Run read-only SQL for advanced inspection. |
| `GET /events/:correlationId` | Return all events for a correlation id. |
| `GET /columns` | List baseline, overflow, promoted, and failed columns. |

Omitted `scope` defaults to `"main"`, which applies `main = true`; use `scope: "all"` for event-level drill-down.

## Configuration

Required for DuckDB:

| Variable | Description |
| --- | --- |
| `WIDE_EVENTS_DUCKDB_PATH` | Path to the DuckDB database file. |

Common optional settings:

| Variable | Default |
| --- | --- |
| `WIDE_EVENTS_STORAGE` | `duckdb` |
| `WIDE_EVENTS_COLLECTOR_PORT` | `4318` |
| `WIDE_EVENTS_BATCH_SIZE` | `100` |
| `WIDE_EVENTS_BATCH_TIMEOUT_MS` | `1000` |
| `WIDE_EVENTS_RETENTION_DAYS` | `30` |
| `WIDE_EVENTS_QUEUE_LIMIT` | `10000` |

Promotion settings:

| Variable | Default |
| --- | --- |
| `WIDE_EVENTS_MAX_PROMOTED_COLUMNS` | `200` |
| `WIDE_EVENTS_PROMOTION_INTERVAL_MS` | `300000` |
| `WIDE_EVENTS_PROMOTION_MIN_ROWS` | `1000` |
| `WIDE_EVENTS_PROMOTION_MIN_RATIO` | `0.01` |
| `WIDE_EVENTS_PROMOTION_MAX_KEYS_PER_RUN` | `25` |

ClickHouse settings:

| Variable | Default |
| --- | --- |
| `WIDE_EVENTS_CLICKHOUSE_URL` | Required when `WIDE_EVENTS_STORAGE=clickhouse`. |
| `WIDE_EVENTS_CLICKHOUSE_DATABASE` | Required database name; created when missing. |
| `WIDE_EVENTS_CLICKHOUSE_USERNAME` | `default` |
| `WIDE_EVENTS_CLICKHOUSE_PASSWORD` | Empty |

DuckDB and ClickHouse use the same event model and collector APIs. To migrate, stop ingest, copy the data you want to retain into ClickHouse, change the storage environment variables, and restart the collector. The collector does not copy existing DuckDB data automatically.

## Notes

- Unknown fields and `attributes` entries land in `attributes_overflow` until promoted.
- `/sql` is intentionally read-only.
- The collector has no built-in auth. Keep it behind a trusted network boundary.
