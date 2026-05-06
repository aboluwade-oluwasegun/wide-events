---
"@wide-events/sdk": minor
"@wide-events/internal": minor
"@wide-events/collector": minor
"@wide-events/client": minor
"@wide-events/pino": minor
---

Replace OTLP trace ingestion with native structured wide events, remove OpenTelemetry dependencies from the SDK, rename public trace/span APIs to event terminology, and add the optional Pino bridge package.

Add optional Node instrumentation subpaths for Postgres (`instrumentPg`), AWS SDK v3 Smithy middleware (`instrumentAwsSdkV3`), and Redis via `ioredis` (`instrumentIoredis`); refactor outbound `fetch` helpers into shared `instrumentation/fetch`; export optional `InstrumentationHooks` type alongside optional `pg`/`ioredis` peerDependencies.

Rename instrumentation type exports: `PgPoolLike` → `PgPoolTarget`, `IoredisClientLike` → `IoredisClientTarget`, `AwsSdkV3ClientLike` → `AwsSdkV3ClientTarget`.
