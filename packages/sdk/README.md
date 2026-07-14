# @wide-events/sdk

Structured event SDK for Node, Lambda, and edge runtimes.

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
import { WideEvents } from "@wide-events/sdk";

const wideEvents = new WideEvents({
  serviceName: "orders-lambda",
  collectorUrl: process.env.WIDE_EVENTS_COLLECTOR_URL,
});

export const handler = wideEvents.wrapHandler(async (event) => {
  wideEvents.annotate({ "http.route": event.rawPath });
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

## Core API

| Method | Purpose |
| --- | --- |
| `run(initial, callback)` | Manually create an event context. |
| `middleware()` | Node request lifecycle middleware. |
| `route(handler)` | Wrap a Node HTTP route handler with event lifecycle and error capture. |
| `expressMiddleware()` / `fastifyPlugin()` | Express and Fastify request lifecycle adapters. |
| `honoMiddleware()` / `nestMiddleware()` / `nestInterceptor()` | Hono and Nest request lifecycle adapters. |
| `wrapHandler(handler)` | Lambda-style event lifecycle wrapper. |
| `fetchHandler(request, ctx, handler)` | Edge request lifecycle helper. |
| `annotate(attributes, options?)` | Add structured fields to the active event. |
| `push(key, value)` | Append repeated nested values such as DB calls. |
| `recordError(error, options?)` | Record an error on the active event. |
| `current()` | Return the current materialized event, if one is active. |
| `wrapFetch(fetch?)` / `instrumentFetch()` | Instrument outbound fetch calls. |
| `restoreFetch()` | Restore a patched global fetch. |
| `flush()` / `forceFlush()` | Send queued events to the collector. |
| `shutdown()` | Restore patched fetch and flush queued events. |

Automatic exception details are guaranteed only when the SDK owns the execution boundary. Plain Node middleware marks `status >= 500` responses as failed; use platform wrappers when you need thrown-error details without manual `recordError()`.

## Instrumentation

Node-only integrations can be configured when the SDK is created:

```ts
const wideEvents = new WideEvents(
  { serviceName: "api", collectorUrl },
  {
    fetch: true,
    pg: [pool],
    redis: [redis],
    aws: [dynamoClient],
  },
);
```

Manual installers are also available as subpaths:

- `@wide-events/sdk/instrumentation/pg`
- `@wide-events/sdk/instrumentation/aws-sdk-v3`
- `@wide-events/sdk/instrumentation/ioredis`

Emitted attribute arrays use these keys:

| Integration | Success key | Failure key |
| --- | --- | --- |
| fetch | `http.client.requests` | `http.client.errors` |
| Postgres | `db.queries` | `db.errors` |
| AWS SDK v3 | `aws.client.operations` | `aws.client.errors` |
| ioredis | `redis.commands` | `redis.errors` |

See the [Node service example](../../examples/node-service/README.md) for optional Postgres, Redis, and DynamoDB snippets.

## Framework Adapters

Use the framework-specific helpers when you want request lifecycle integration without wiring the generic middleware yourself:

```ts
app.use(wideEvents.expressMiddleware());
await fastify.register(wideEvents.fastifyPlugin());
```

Hono and Nest helpers are exported as `honoMiddleware()`, `nestMiddleware()`, and `nestInterceptor()`.
