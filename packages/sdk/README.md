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

## API

| Method | Purpose |
| --- | --- |
| `middleware()` | Creates Node request middleware and flushes an event on response finish. |
| `wrapHandler(handler)` | Wraps Lambda-style handlers with event lifecycle, error capture, and flush. |
| `fetchHandler(request, ctx, handler)` | Edge request lifecycle helper. |
| `annotate(attributes, options?)` | Adds structured fields to the active event. |
| `push(key, value)` | Appends nested values, useful for repeated operations like DB calls. |
| `recordError(error, options?)` | Records an error on the active event. |
| `current()` | Returns the current materialized event, if one is active. |
| `wrapFetch(fetch?)` | Returns an instrumented fetch function. |
| `instrumentFetch()` | Wraps `globalThis.fetch` for fetch-based HTTP clients. |
| `flush()` / `forceFlush()` | Sends queued events to the collector. |
| `shutdown()` | Restores patched fetch and flushes queued events. |

Automatic exception details are guaranteed only where the SDK owns the execution boundary. Plain Node middleware marks `status >= 500` as failed; use route wrappers or platform wrappers for thrown-error details.
