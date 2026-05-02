# wide-events

Self-hosted structured event observability on DuckDB.

`wide-events` stores one row per wide event. Applications send native JSON events to the collector, the collector writes them into DuckDB, and the query API supports product-style questions over high-cardinality fields. Stable dynamic fields can be promoted into typed DuckDB columns; overflow fields remain available through SQL.

## Packages

| Package                  | Role                                                       |
| ------------------------ | ---------------------------------------------------------- |
| `@wide-events/sdk`       | Lightweight Node, Lambda, and edge structured event SDK.   |
| `@wide-events/pino`      | Optional Pino bridge for log mixins and event sinks.       |
| `@wide-events/client`    | Typed HTTP client for querying the collector.              |
| `@wide-events/collector` | Collector server, query API, and CLI entrypoint.           |

Package-specific docs:

- [packages/sdk/README.md](packages/sdk/README.md)
- [packages/pino/README.md](packages/pino/README.md)
- [packages/client/README.md](packages/client/README.md)
- [packages/collector/README.md](packages/collector/README.md)

## Quick Start

1. Start a collector.
2. Point the SDK at the collector URL.
3. Query the collector with the client or raw HTTP.

### Run the collector from npm

```bash
WIDE_EVENTS_DUCKDB_PATH=./wide-events.db npx wide-events-collector
```

The collector listens on `http://localhost:4318` by default.

### Run the collector with Docker

The Docker workflow publishes to `docker.io/oluwasegun7/wide-events-collector`.

```bash
docker pull oluwasegun7/wide-events-collector:0.2.0

docker run --rm \
  -e WIDE_EVENTS_DUCKDB_PATH=/data/wide-events.db \
  -v "$(pwd)/wide-events-data:/data" \
  -p 4318:4318 \
  oluwasegun7/wide-events-collector:0.2.0
```

## Instrument an Application

```bash
npm install @wide-events/sdk
```

```ts
import { WideEvents } from "@wide-events/sdk";

const wideEvents = new WideEvents({
  serviceName: "orders-api",
  environment: "production",
  collectorUrl: "http://localhost:4318",
});

app.use(wideEvents.middleware());

app.post("/orders", async (req, res) => {
  wideEvents.annotate(
    {
      "user.id": req.user.id,
      "order.total": req.body.total,
    },
    { promote: ["order.total"] },
  );

  res.sendStatus(201);
});
```

`annotate()` writes fields onto the active event. `push()` appends nested data such as database calls:

```ts
wideEvents.push("db.queries", {
  operation: "select_order",
  duration_ms: 12,
});
```

SDK wrappers automatically record thrown errors when they own the execution boundary. Plain Node middleware marks `status >= 500` responses as failed; use SDK route wrappers or platform wrappers when you need exception details without manual `recordError()`.

### Edge and Workers

```ts
import { WideEvents } from "@wide-events/sdk/edge";

const wideEvents = new WideEvents({
  serviceName: "edge-gateway",
  collectorUrl: "https://collector.example.com",
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return wideEvents.fetchHandler(request, ctx, () => new Response("ok"));
  },
};
```

### Optional Pino Bridge

```bash
npm install @wide-events/pino pino
```

```ts
import pino from "pino";
import { pinoEventSink, pinoMixin } from "@wide-events/pino";

const logger = pino();
const wideEvents = new WideEvents({
  serviceName: "orders-api",
  sink: pinoEventSink(logger),
});
const requestLogger = pino({ mixin: pinoMixin(wideEvents) });
```

## Query the Collector

```bash
npm install @wide-events/client
```

```ts
import { WideEventsClient } from "@wide-events/client";

const client = new WideEventsClient({ url: "http://localhost:4318" });

const result = await client.query({
  select: [{ fn: "P95", field: "duration_ms", as: "p95_ms" }],
  filters: [{ field: "service.name", op: "eq", value: "orders-api" }],
  groupBy: ["http.route"],
});
```

Structured queries default to `scope: "main"`, which means the collector injects `main = true` unless you explicitly set `scope: "all"`. Structured queries target baseline and promoted columns; overflow-only keys remain available through `/sql`.

## Collector Configuration

Required:

- `WIDE_EVENTS_DUCKDB_PATH`: path to the DuckDB file

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

## Notes

- The collector accepts native wide events at `POST /v1/events`.
- Event drill-down uses `GET /events/:correlationId`.
- Overflow-only keys stay queryable through `/sql`, for example with `map_extract_value(attributes_overflow, 'feature.flag')`.
- `/sql` is intentionally read-only.
- The collector has no built-in auth. Keep it behind a trusted network boundary.
