# @wide-events/sdk

## 1.0.0

### Major Changes

- Release the stable v1 package suite with ClickHouse storage, hardened collector storage behavior, smaller framework-specific SDK adapters, and consolidated package documentation.

### Patch Changes

- Updated dependencies
  - @wide-events/internal@1.0.0

## 0.4.1

### Patch Changes

- 880bed8: Fix published SDK package imports so bundled consumers can resolve shared runtime dependencies.

## 0.4.0

### Minor Changes

- 6235b5d: Replace OTLP trace ingestion with native structured wide events, remove OpenTelemetry dependencies from the SDK, rename public trace/span APIs to event terminology, and add the optional Pino bridge package.

  Add optional Node instrumentation subpaths for Postgres (`instrumentPg`), AWS SDK v3 Smithy middleware (`instrumentAwsSdkV3`), and Redis via `ioredis` (`instrumentIoredis`); refactor outbound `fetch` helpers into shared `instrumentation/fetch`; export optional `InstrumentationHooks` type alongside optional `pg`/`ioredis` peerDependencies.

  Rename instrumentation type exports: `PgPoolLike` → `PgPoolTarget`, `IoredisClientLike` → `IoredisClientTarget`, `AwsSdkV3ClientLike` → `AwsSdkV3ClientTarget`.

### Patch Changes

- Updated dependencies [6235b5d]
  - @wide-events/internal@0.3.0

## 0.3.0

### Minor Changes

- 28277d1: Add optional AWS SDK auto-instrumentation for Node with Lambda-aware defaults, plus an active-span annotation API for labeling child spans such as DynamoDB query spans.

## 0.2.0

### Minor Changes

- c517b83: dynamic span attributes now land in overflow first, the collector can promote stable keys into typed columns (with optional SDK annotate(..., { promote }) hints), structured queries stay on baseline plus promoted fields while overflow-only keys stay reachable via /sql, and the HTTP client returns clearer errors on failed responses

### Patch Changes

- Updated dependencies [c517b83]
  - @wide-events/internal@0.2.0

## 0.1.1

### Patch Changes

- f2ebc5e: General optimizations/cleanup
- Updated dependencies [f2ebc5e]
  - @wide-events/internal@0.1.1
