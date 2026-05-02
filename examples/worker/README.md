# Worker example

Cloudflare Worker-style request handler instrumented with `@wide-events/sdk/edge`.

The example uses `fetchHandler()` to create one event per request and schedules export with `executionContext.waitUntil()`.

```ts
return wideEvents.fetchHandler(request, executionContext, () => {
  wideEvents.annotate({ "http.route": new URL(request.url).pathname });
  return new Response(JSON.stringify({ ok: true }));
});
```
