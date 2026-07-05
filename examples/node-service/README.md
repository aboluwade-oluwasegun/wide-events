# Node service example

Minimal Node HTTP service instrumented with `@wide-events/sdk`.

```bash
WIDE_EVENTS_COLLECTOR_URL=http://localhost:4318 pnpm --filter wide-events-example-node-service dev
```

The example creates one main event per request, annotates `http.route`, and exports native JSON to `POST /v1/events`.

## Project rules Express example

[`src/project-rules-express.ts`](src/project-rules-express.ts) shows the project-rules middleware flow for an Express-shaped app:

1. Create a Wide Events SaaS API key and attach the `project_checkout` project to it.
2. Configure the SDK with `apiKey`, `apiUrl`, and `projects.ids`.
3. Install `wideEvents.expressMiddleware()`.
4. Let the middleware extract request and response fields into `project_events`; the route handler does not call `annotateProject()`.

The exported `checkoutProjectDiscoveryResponse` constant shows the discovery/CDN response shape the SaaS platform returns: a `rulesUrl` plus project-scoped `rules.routes`.

## DynamoDB helper

[`src/dynamodb-query.ts`](src/dynamodb-query.ts) shows the same ordering used by the constructor-based instrumentation API:

1. Create a base `DynamoDBClient`.
2. Instrument the base client (either directly or via `new WideEvents(coreOptions, { aws: [baseClient] })`).
3. Build `DynamoDBDocumentClient.from(baseClient)` and reuse that client everywhere.

Manual fields such as `"dynamodb.query_name"` are still appended with `wideEvents.annotate()` when you want app-level labels alongside auto-captured timings.

## Optional Postgres and Redis snippets

[`src/pg-health.ts`](src/pg-health.ts) and [`src/redis-health.ts`](src/redis-health.ts) are **opt-in**:

- Postgres — set `DATABASE_URL` (omit it to skip the helper entirely).
- Redis — set `REDIS_URL` (omit it to skip the helper entirely).

Neither file is wired into [`src/server.ts`](src/server.ts) so the toy HTTP server stays dependency-light; copy the patterns where you compose `Pool`/`Redis` and pass them via:

```ts
new WideEvents(coreOptions, {
  pg: [pool],
  redis: [redis],
});
```

[`docker-compose.yml`](docker-compose.yml) starts local Postgres (`wide`/`wide`) and Redis for manual testing:

```bash
docker compose -f examples/node-service/docker-compose.yml up -d
export DATABASE_URL=postgres://wide:wide@127.0.0.1:5432/widetest
export REDIS_URL=redis://127.0.0.1:6379
```

TypeScript maps `@wide-events/sdk/instrumentation/*` to workspace sources inside this example (`tsconfig.json` `paths`) so `pnpm typecheck` works before `packages/sdk/dist` exists.

For SDK typing: Postgres and Redis use official client types, while AWS uses a lightweight hybrid client type so SDK dependencies stay minimal.
