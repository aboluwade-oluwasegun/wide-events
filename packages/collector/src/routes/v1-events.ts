import type { FastifyInstance } from "fastify";
import { wideEventBatchSchema } from "@wide-events/internal";
import { normalizeEventBatch } from "../events/normalize.js";
import type { CollectorDependencies } from "../server.js";

export function registerEventRoutes(
  app: FastifyInstance,
  dependencies: CollectorDependencies,
): void {
  app.post("/v1/events", async (request, reply) => {
    const body = wideEventBatchSchema.parse(request.body);
    const rows = normalizeEventBatch(body);
    await dependencies.store.enqueueRows(rows);
    await reply.code(202).send({ accepted: rows.length });
  });
}
