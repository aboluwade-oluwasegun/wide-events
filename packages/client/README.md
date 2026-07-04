# @wide-events/client

Typed HTTP client for the Wide Events collector query APIs.

## Install

```bash
npm install @wide-events/client
```

## Usage

```ts
import { WideEventsClient } from "@wide-events/client";

const client = new WideEventsClient({ url: "http://localhost:4318" });
const columns = await client.getColumns();
const projectColumns = await client.getColumns("project_events");
```

## API

| Method | Description |
| --- | --- |
| `query(request)` | Executes a structured query through `POST /query`. |
| `sql(queryText)` | Executes read-only SQL through `POST /sql`. |
| `getColumns(source?)` | Returns collector schema metadata from `GET /columns`, or project columns from `GET /columns?source=project_events`. |
| `getEvents(correlationId)` | Returns all rows for a correlation id from `GET /events/:correlationId`. |

## Structured query DSL

```ts
const result = await client.query({
  select: [
    { fn: "COUNT", as: "requests" },
    { fn: "P95", field: "duration_ms", as: "p95_duration_ms" }
  ],
  filters: [
    { field: "service.name", op: "eq", value: "api" },
    { field: "http.status_code", op: "gte", value: 500 }
  ],
  groupBy: ["http.route"],
  orderBy: { field: "requests", dir: "desc" },
  limit: 20
});
```

### Supported aggregate functions

- `COUNT`
- `SUM`
- `AVG`
- `MIN`
- `MAX`
- `P50`
- `P95`
- `P99`

### Supported filter operators

- `eq`
- `neq`
- `gt`
- `gte`
- `lt`
- `lte`
- `in`

### Scope

`StructuredQuery` supports `scope?: "main" | "all"`.

- Omitted `scope` defaults to `"main"`.
- `"main"` means the collector injects `main = true`.
- `"all"` queries all stored events.

Use `"all"` for event-level drill-down. Leave it at the default for product-style wide-event queries.

`StructuredQuery` also supports `source?: "events" | "project_events"`.

- Omitted `source` defaults to `"events"`.
- `"project_events"` targets project-scoped events and validates filters, groups, and selected fields against the project event table columns.

## Raw SQL

```ts
const rows = await client.sql(`
  SELECT "service.name", COUNT(*) AS requests
  FROM events
  WHERE main = true
  GROUP BY 1
  ORDER BY requests DESC
`);
```

`/sql` is read-only in v0.1. Statements such as `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `CREATE`, and `DROP` are rejected.

## Errors

Collector errors are surfaced as thrown `Error` instances using the collector response body:

- `400` for invalid request payloads or invalid query shapes
- `503` for queue saturation on ingest
- `500` for unexpected collector failures

Error bodies remain `{ error: string }`, so the client throws that string message when present.
