# @wide-events/sdk

Lightweight structured event SDK for Node, Lambda, and edge runtimes.

## Install

```bash
npm install @wide-events/sdk
```

## Node

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

## Lambda

```ts
const wideEvents = new WideEvents({
  serviceName: "orders-lambda",
  collectorUrl: process.env.WIDE_EVENTS_COLLECTOR_URL,
});

export const handler = wideEvents.wrapHandler(async (event) => {
  wideEvents.annotate({
    "http.route": event.rawPath,
  });

  return { statusCode: 200, body: "ok" };
});
```

`wrapHandler()` records thrown errors automatically, flushes in `finally`, and rethrows failures.

## Edge

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

## Project-Scoped Events

Project routing is opt-in. Omit `projects` or set it to `false` for default events only.

Use explicit project IDs when the app already knows the projects it can emit:

```ts
const wideEvents = new WideEvents({
  serviceName: "checkout-api",
  environment: "production",
  collectorUrl: "https://collector.example.com",
  projects: ["project_checkout"],
});

app.post("/checkout", async (req, res) => {
  wideEvents.annotateProject({
    "cart.item_count": req.body.items.length,
    "order.total": req.body.total,
    "checkout.converted": true,
  });

  res.sendStatus(201);
});
```

Use collector-driven routing when project config should update without redeploying the app:

```ts
const wideEvents = new WideEvents({
  serviceName: "checkout-api",
  environment: "production",
  collectorUrl: "https://collector.example.com",
  projects: true,
});
```

With `projects: true`, the SDK fetches `GET /v1/projects/config` from the collector during export, caches the response for the collector-provided TTL, and refreshes after the TTL expires. `annotateProject()` emits project events with `project_id`, `project_rule_version`, `project_fields`, and `project_field_types`; those events are stored by the collector in `project_events`, not the default `events` table.

### Project Rules Middleware

Project rules let framework middleware extract project fields from request and response data without manually calling `annotateProject()` in route business logic.

Configure the SDK with a CDN-hosted JSON rules document:

```ts
const wideEvents = new WideEvents({
  serviceName: "checkout-api",
  environment: "production",
  collectorUrl: "https://collector.example.com",
  projects: ["project_checkout"],
  projectRules: {
    url: "https://cdn.example.com/wide-events/checkout-project-rules.json",
    refreshIntervalMs: 60_000,
  },
});
```

`projectRules.url` must return JSON. The SDK fetches it on demand, caches it for `refreshIntervalMs`, keeps the last valid rules when refresh fails, and disables automatic project extraction when no valid rules are available.

Rules use exact method/path matching and direct dot-path extraction only:

```json
{
  "version": 1,
  "rules": [
    {
      "project_id": "project_checkout",
      "project_rule_version": "2026-07-01",
      "match": {
        "method": "POST",
        "path": "/checkout"
      },
      "fields": [
        {
          "field": "cart.item_count",
          "source": "request.body",
          "path": "cart.itemCount",
          "type": "BIGINT"
        },
        {
          "field": "order.total",
          "source": "response.body",
          "path": "order.total",
          "type": "DOUBLE"
        },
        {
          "field": "response.status",
          "source": "response.status",
          "type": "BIGINT"
        }
      ]
    }
  ]
}
```

Supported field sources are `request.body`, `request.query`, `request.params`, `request.headers`, `response.body`, and `response.status`. All sources except `response.status` require `path`. Supported field types are `BOOLEAN`, `BIGINT`, `DOUBLE`, `VARCHAR`, and `JSON`. Set `"optional": true` on a field to skip it when the path is missing; otherwise missing values are emitted as `null`.

Framework adapters use the same rules engine:

```ts
app.use(wideEvents.expressMiddleware());
```

```ts
await fastify.register(wideEvents.fastifyPlugin());
```

Hono and Nest helpers are also exported as `honoMiddleware()`, `nestMiddleware()`, and `nestInterceptor()`.

## Instrumentation

Instrumentation is Node-only and client-driven for database/cache/aws clients. The preferred API is a constructor-level instrumentation object:

```ts
import { WideEvents } from "@wide-events/sdk";
import { Pool } from "pg";
import Redis from "ioredis";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });
const redis = new Redis(process.env["REDIS_URL"] ?? "");
const dynamo = new DynamoDBClient({});

const wideEvents = new WideEvents(
  { serviceName: "api", collectorUrl },
  {
    fetch: true,
    pg: [pool],
    redis: [redis],
    aws: [dynamo], // instrument base AWS SDK v3 client
  },
);

const doc = DynamoDBDocumentClient.from(dynamo);
```

`fetch` in the second argument is equivalent to `autoInstrument.fetch` in the core options (kept for backward compatibility). If both are present, the second argument value is used.

You can still instrument manually with subpath installers when you want per-client options:

```ts
import { instrumentPg } from "@wide-events/sdk/instrumentation/pg";
import { instrumentAwsSdkV3 } from "@wide-events/sdk/instrumentation/aws-sdk-v3";
import { instrumentIoredis } from "@wide-events/sdk/instrumentation/ioredis";

instrumentPg(pool, wideEvents, { sqlTruncateLength: 120 });
instrumentIoredis(redis, wideEvents);
instrumentAwsSdkV3(dynamo, wideEvents);
```

Node-only integrations are exposed as package subpaths so edge bundles never pull TCP clients:

```bash
npm install @wide-events/sdk pg ioredis
npm install @wide-events/sdk @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

Typing strategy keeps the SDK small:

- `pg` / `ioredis` use official library types in constructor and installer signatures for strong autocomplete.
- AWS SDK v3 uses a lightweight hybrid client contract (`AwsSdkV3ClientTarget`) to stay compatible across Smithy overloads without adding heavy dependency coupling.

`WideEvents` satisfies `InstrumentationHooks`, so helper functions can stay generic:

```ts
import type { InstrumentationHooks } from "@wide-events/sdk";

function helper(hooks: InstrumentationHooks, pool: Pool) {
  instrumentPg(pool, hooks);
}
```

Emitted **attribute arrays** use dotted keys aligned with outbound HTTP instrumentation:

| Subpath | Success key | Failure key |
| --- | --- | --- |
| (fetch / SDK) | `http.client.requests` | `http.client.errors` |
| `@wide-events/sdk/instrumentation/pg` | `db.queries` | `db.errors` |
| `@wide-events/sdk/instrumentation/aws-sdk-v3` | `aws.client.operations` | `aws.client.errors` |
| `@wide-events/sdk/instrumentation/ioredis` | `redis.commands` | `redis.errors` |

## API

| Method | Purpose |
| --- | --- |
| `middleware()` | Creates Node request middleware and flushes an event on response finish. |
| `expressMiddleware()` | Creates project-aware Express-compatible middleware. |
| `fastifyPlugin()` | Registers project-aware Fastify hooks. |
| `honoMiddleware()` | Creates project-aware Hono-compatible middleware. |
| `nestMiddleware()` | Creates project-aware Nest middleware for Express-backed HTTP apps. |
| `nestInterceptor()` | Creates a Nest-style interceptor helper for response-value extraction. |
| `wrapHandler(handler)` | Wraps Lambda-style handlers with event lifecycle, error capture, and flush. |
| `fetchHandler(request, ctx, handler)` | Edge request lifecycle helper. |
| `annotate(attributes, options?)` | Adds structured fields to the active event. |
| `annotateProject(fields, options?)` | Adds typed project fields to the active event for project-scoped storage. |
| `push(key, value)` | Appends nested values, useful for repeated operations like DB calls. |
| `recordError(error, options?)` | Records an error on the active event. |
| `current()` | Returns the current materialized event, if one is active. |
| `wrapFetch(fetch?)` | Returns an instrumented fetch function. |
| `instrumentFetch()` | Wraps `globalThis.fetch` for fetch-based HTTP clients. |
| `flush()` / `forceFlush()` | Sends queued events to the collector. |
| `shutdown()` | Restores patched fetch and flushes queued events. |

Automatic exception details are guaranteed only where the SDK owns the execution boundary. Plain Node middleware marks `status >= 500` as failed; use route wrappers or platform wrappers for thrown-error details.
