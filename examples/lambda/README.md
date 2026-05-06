# Lambda example

AWS Lambda-style handler wrapped with `@wide-events/sdk`.

The wrapper creates one event per invocation, records route metadata, captures thrown errors automatically, flushes in `finally`, and rethrows failures.

```ts
const wideEvents = new WideEvents({
  serviceName: "example-lambda",
  collectorUrl: process.env.WIDE_EVENTS_COLLECTOR_URL,
});

export const handler = wideEvents.wrapHandler(async (event) => {
  wideEvents.annotate({ "http.route": event.rawPath });
  return { statusCode: 200, body: "ok" };
});
```
