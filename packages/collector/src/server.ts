import Fastify, { type FastifyInstance } from "fastify";
import type { CollectorConfig } from "./config";
import { readCollectorConfig } from "./config";
import { resolveCollectorError } from "./errors";
import type { CollectorLogger } from "./logger";
import { registerColumnRoutes } from "./routes/columns";
import { registerHealthRoute } from "./routes/health";
import { registerQueryRoutes } from "./routes/query";
import { registerSqlRoutes } from "./routes/sql";
import { registerEventQueryRoutes } from "./routes/events";
import { registerEventRoutes } from "./routes/v1-events";
import { PromotionJob } from "./jobs/promotion";
import { DuckDbDatabase } from "./storage/database";
import { AttributeCatalog } from "./storage/attribute-catalog";
import { SchemaRegistry } from "./storage/schema-registry";
import { CollectorStore } from "./storage/store";
import { RetentionJob } from "./jobs/retention";

export interface CollectorDependencies {
  config: CollectorConfig;
  database: DuckDbDatabase;
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
  const database = await DuckDbDatabase.create(config.duckDbPath);
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
      database.close();
    }
  };
}
