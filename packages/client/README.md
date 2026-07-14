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

const result = await client.query({
  select: [
    { fn: "COUNT", as: "requests" },
    { fn: "P95", field: "duration_ms", as: "p95_duration_ms" },
  ],
  filters: [
    { field: "service.name", op: "eq", value: "api" },
    { field: "http.status_code", op: "gte", value: 500 },
  ],
  groupBy: ["http.route"],
  orderBy: { field: "requests", dir: "desc" },
  limit: 20,
});
```

## API

| Method | Description |
| --- | --- |
| `query(request)` | Executes a structured query through `POST /query`. |
| `sql(queryText)` | Executes read-only SQL through `POST /sql`. |
| `getColumns()` | Returns collector schema metadata from `GET /columns`. |
| `getEvents(correlationId)` | Returns all rows for a correlation id from `GET /events/:correlationId`. |

## Query Notes

Supported aggregate functions are `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `P50`, `P95`, and `P99`.

Supported filter operators are `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, and `in`.

`StructuredQuery` supports:

- `scope?: "main" | "all"` - omitted `scope` defaults to `"main"`.

Use `/sql` for overflow-only keys or backend-specific inspection.

## Errors

Collector errors are thrown as `Error` instances. When the collector response body includes `{ error: string }`, the client uses that string as the message.
