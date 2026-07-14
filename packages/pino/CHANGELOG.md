# @wide-events/pino

## 0.1.1

### Patch Changes

- Updated dependencies [880bed8]
  - @wide-events/sdk@0.4.1

## 0.1.0

### Minor Changes

- 6235b5d: Replace OTLP trace ingestion with native structured wide events, remove OpenTelemetry dependencies from the SDK, rename public trace/span APIs to event terminology, and add the optional Pino bridge package.

  Add optional Node instrumentation subpaths for Postgres (`instrumentPg`), AWS SDK v3 Smithy middleware (`instrumentAwsSdkV3`), and Redis via `ioredis` (`instrumentIoredis`); refactor outbound `fetch` helpers into shared `instrumentation/fetch`; export optional `InstrumentationHooks` type alongside optional `pg`/`ioredis` peerDependencies.

  Rename instrumentation type exports: `PgPoolLike` → `PgPoolTarget`, `IoredisClientLike` → `IoredisClientTarget`, `AwsSdkV3ClientLike` → `AwsSdkV3ClientTarget`.

### Patch Changes

- Updated dependencies [6235b5d]
  - @wide-events/sdk@0.4.0
  - @wide-events/internal@0.3.0
