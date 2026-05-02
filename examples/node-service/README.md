# Node service example

Minimal Node HTTP service instrumented with `@wide-events/sdk`.

```bash
WIDE_EVENTS_COLLECTOR_URL=http://localhost:4318 pnpm --filter wide-events-example-node-service start
```

The example creates one main event per request, annotates `http.route`, and exports native JSON to `POST /v1/events`.

The DynamoDB helper shows the lightweight manual instrumentation style: add a stable application field with `wideEvents.annotate()` or append repeated operation details with `wideEvents.push()`.
