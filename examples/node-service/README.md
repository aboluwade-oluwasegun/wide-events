# Node service example

Minimal Node HTTP service instrumented with `@wide-events/sdk`.

Start a collector first, then run the example:

```bash
WIDE_EVENTS_COLLECTOR_URL=http://localhost:4318 pnpm --filter wide-events-example-node-service dev
```

The example creates one main event per request, annotates `http.route`, and exports native JSON to `POST /v1/events`.

## Included snippets

- [`src/dynamodb-query.ts`](src/dynamodb-query.ts) shows AWS SDK v3 instrumentation order.
- [`src/pg-health.ts`](src/pg-health.ts) and [`src/redis-health.ts`](src/redis-health.ts) are optional Postgres and Redis instrumentation examples.

For SDK setup and API notes, see [packages/sdk/README.md](../../packages/sdk/README.md).

## Optional Postgres and Redis

The Postgres and Redis helpers are not wired into [`src/server.ts`](src/server.ts). Set the relevant environment variable only when you want to exercise the helper:

- Postgres: `DATABASE_URL`
- Redis: `REDIS_URL`

Local services are available through the example compose file:

```bash
docker compose -f examples/node-service/docker-compose.yml up -d
export DATABASE_URL=postgres://wide:wide@127.0.0.1:5432/widetest
export REDIS_URL=redis://127.0.0.1:6379
```
