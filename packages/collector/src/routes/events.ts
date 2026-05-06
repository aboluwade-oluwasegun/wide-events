import type { FastifyInstance } from "fastify";
import { eventsParamsSchema } from "@wide-events/internal";
import type { CollectorDependencies } from "../server";

export function registerEventQueryRoutes(
  app: FastifyInstance,
  dependencies: CollectorDependencies,
): void {
  app.get("/events/:correlationId", async (request) => {
    const params = eventsParamsSchema.parse(request.params);
    const rows = await dependencies.database.executeRead(
      `SELECT * FROM events WHERE correlation_id = ? ORDER BY ts ASC`,
      [params.correlationId],
    );
    return {
      correlationId: params.correlationId,
      rows,
    };
  });
}
