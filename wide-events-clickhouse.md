# wide-events ClickHouse storage

DuckDB remains the default backend. ClickHouse is optional for deployments that need a separate analytical database, more write throughput, or longer retention than a single embedded DuckDB file should handle.

## Enable ClickHouse

```bash
WIDE_EVENTS_STORAGE=clickhouse \
WIDE_EVENTS_CLICKHOUSE_URL=http://localhost:8123 \
WIDE_EVENTS_CLICKHOUSE_DATABASE=wide_events \
WIDE_EVENTS_CLICKHOUSE_USERNAME=default \
npx wide-events-collector
```

Optional:

- `WIDE_EVENTS_CLICKHOUSE_PASSWORD`

On startup, the collector creates the database, `events`, and `attribute_catalog` if they do not exist.

## Storage Model

The logical event model is the same as DuckDB:

- baseline fields are stored as typed columns in `events`
- sparse dynamic fields are stored in `attributes_overflow`
- promoted dynamic fields are added as nullable typed columns
- `attribute_catalog` tracks overflow and promotion state

The ClickHouse physical model differs:

- `events` uses `MergeTree`, ordered by `ts`, `service.name`, `correlation_id`, and `event_id`
- `attributes_overflow` is `Map(String, String)`; non-string dynamic values are serialized before insert
- `attribute_catalog` uses `ReplacingMergeTree(updated_at)` so each catalog update appends a newer version

## Query Notes

`POST /query` uses backend-specific SQL generation. Percentiles compile to DuckDB syntax on DuckDB and ClickHouse syntax on ClickHouse.

`POST /sql` is intentionally raw and backend-specific. DuckDB overflow examples use `map_extract_value(...)`; ClickHouse overflow inspection should use ClickHouse map syntax, for example:

```sql
SELECT attributes_overflow['feature.flag'] FROM events;
```

## Performance Posture

DuckDB:

- best default for local, single-node, low-ops deployments
- embedded file, no database server to operate
- collector serializes writes, which matches DuckDB's single-writer model

ClickHouse:

- better fit for higher ingest volume, larger retention windows, and concurrent analytical reads
- requires operating a ClickHouse server and monitoring table mutations
- retention and promotion backfills become ClickHouse mutations; monitor mutation backlog on large tables

## Migration Posture

There is no automatic DuckDB-to-ClickHouse migration in the collector.

For an existing deployment, treat ClickHouse as a cutover:

1. Start a new collector with `WIDE_EVENTS_STORAGE=clickhouse`.
2. Point SDKs or ingress traffic at the new collector.
3. Keep the old DuckDB collector or file available for historical queries until its retention window expires.
4. Export/import historical rows separately if full backfill into ClickHouse is required.

Do not point one collector at DuckDB and ClickHouse simultaneously. The configured storage backend is exclusive per collector process.
