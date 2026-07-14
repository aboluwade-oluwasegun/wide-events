# wide-events

Self-hosted structured event observability for Node, Lambda, and edge apps.

Applications send native JSON events to a collector. The collector stores one row per event in an analytical backend, DuckDB by default, and exposes query APIs for high-cardinality product and operations questions.

## Packages

| Package | Purpose |
| --- | --- |
| `@wide-events/sdk` | Instrument Node, Lambda, and edge apps. |
| `@wide-events/client` | Query the collector from TypeScript. |
| `@wide-events/collector` | Run the ingest and query server. |
| `@wide-events/pino` | Optional Pino bridge for log mixins and event sinks. |

`@wide-events/internal` is a shared implementation package pulled in by the public packages. App developers do not need to install it directly.

## Quick Start

Start a collector:

```bash
WIDE_EVENTS_DUCKDB_PATH=./wide-events.db npx --package @wide-events/collector wide-events-collector
```

The collector listens on `http://localhost:4318` by default.

Or run the published Docker image:

```bash
docker pull oluwasegun7/wide-events-collector:1.0.0

docker run --rm \
  -e WIDE_EVENTS_DUCKDB_PATH=/data/wide-events.db \
  -v "$(pwd)/wide-events-data:/data" \
  -p 4318:4318 \
  oluwasegun7/wide-events-collector:1.0.0
```

Instrument an app:

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

  wideEvents.push("db.queries", {
    operation: "select_order",
    duration_ms: 12,
  });

  res.sendStatus(201);
});
```

Query the collector:

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

Structured queries default to `scope: "main"`, so request-level queries use only main events unless you set `scope: "all"`.

## Docs

- [SDK](packages/sdk/README.md)
- [Client](packages/client/README.md)
- [Collector](packages/collector/README.md)
- [Pino bridge](packages/pino/README.md)

Examples:

- [Node service](examples/node-service/README.md)
- [Lambda handler](examples/lambda/README.md)
- [Worker handler](examples/worker/README.md)

## Notes

- The collector accepts native wide events at `POST /v1/events`.
- Overflow-only fields remain available through read-only SQL.
- The collector has no built-in auth. Run it behind a trusted network boundary.
