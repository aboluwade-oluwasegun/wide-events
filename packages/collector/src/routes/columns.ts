import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CollectorDependencies } from "../server.js";

const columnsQuerySchema = z
  .object({
    source: z.enum(["events", "project_events"]).optional(),
  })
  .strict();

export function registerColumnRoutes(
  app: FastifyInstance,
  dependencies: CollectorDependencies
): void {
  app.get("/columns", (request) => {
    const query = columnsQuerySchema.parse(request.query);
    return {
      columns:
        query.source === "project_events"
          ? dependencies.projectSchema.listColumns()
          : dependencies.catalog.listColumns(dependencies.schema)
    };
  });
}
