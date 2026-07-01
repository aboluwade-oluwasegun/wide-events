import Fastify, { type FastifyInstance } from "fastify";
import type { CollectorConfig } from "./config.js";
import { readCollectorConfig } from "./config.js";
import { resolveCollectorError } from "./errors.js";
import type { CollectorLogger } from "./logger.js";
import { registerColumnRoutes } from "./routes/columns.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerQueryRoutes } from "./routes/query.js";
import { registerSqlRoutes } from "./routes/sql.js";
import { registerEventQueryRoutes } from "./routes/events.js";
import { registerEventRoutes } from "./routes/v1-events.js";
import { PromotionJob } from "./jobs/promotion.js";
import { createCollectorDatabase } from "./storage/backend.js";
import { AttributeCatalog } from "./storage/attribute-catalog.js";
import { SchemaRegistry } from "./storage/schema-registry.js";
import { CollectorStore } from "./storage/store.js";
import { RetentionJob } from "./jobs/retention.js";
import type { CollectorDatabase } from "./storage/types.js";

export interface CollectorDependencies {
  config: CollectorConfig;
  database: CollectorDatabase;
  schema: SchemaRegistry;
  catalog: AttributeCatalog;
  store: CollectorStore;
  retentionJob: RetentionJob;
  promotionJob: PromotionJob;
}

export interface CollectorServer {
  app: FastifyInstance;
  dependencies: CollectorDependencies;
  start(): Promise<void>;
  close(): Promise<void>;
}

export async function createCollectorServer(
  config: CollectorConfig = readCollectorConfig()
): Promise<CollectorServer> {
  const app = Fastify({
    logger: true
  });
  const logger: CollectorLogger = {
    info(bindings, message) {
      app.log.info(bindings, message);
    },
    warn(bindings, message) {
      app.log.warn(bindings, message);
    },
    error(bindings, message) {
      app.log.error(bindings, message);
    }
  };
  const database = await createCollectorDatabase(config);
  const schema = new SchemaRegistry(config.maxPromotedColumns);
  await schema.hydrate(database);
  const catalog = new AttributeCatalog();
  await catalog.hydrate(database);
  const store = new CollectorStore(database, schema, catalog, config, logger);
  const retentionJob = new RetentionJob(store);
  const promotionJob = new PromotionJob(store, config);
  const dependencies: CollectorDependencies = {
    config,
    database,
    schema,
    catalog,
    store,
    retentionJob,
    promotionJob
  };

  registerHealthRoute(app);
  registerEventRoutes(app, dependencies);
  registerQueryRoutes(app, dependencies);
  registerSqlRoutes(app, dependencies);
  registerColumnRoutes(app, dependencies);
  registerEventQueryRoutes(app, dependencies);

  app.setErrorHandler((error, request, reply) => {
    const resolved = resolveCollectorError(error);
    const bindings = {
      err: error instanceof Error ? error : new Error(String(error)),
      method: request.method,
      statusCode: resolved.statusCode,
      url: request.url
    };

    if (resolved.logLevel === "warn") {
      app.log.warn(bindings, "collector request rejected");
    } else {
      app.log.error(bindings, "collector request failed");
    }

    void reply.code(resolved.statusCode).send({
      error: resolved.message
    });
  });

  return {
    app,
    dependencies,
    async start() {
      retentionJob.start();
      promotionJob.start();
      await app.listen({
        port: config.port,
        host: "0.0.0.0"
      });
    },
    async close() {
      retentionJob.stop();
      await promotionJob.stop();
      await store.flush();
      await app.close();
      await database.close();
    }
  };
}
