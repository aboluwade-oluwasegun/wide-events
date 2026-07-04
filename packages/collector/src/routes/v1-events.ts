import type { FastifyInstance } from "fastify";
import { wideEventBatchSchema, type ProjectEventRow } from "@wide-events/internal";
import {
  EventNormalizationError,
  normalizeEventBatchForIngest,
} from "../events/normalize.js";
import { BadRequestError } from "../errors.js";
import { ProjectValidationError } from "../projects/registry.js";
import type { CollectorDependencies } from "../server.js";

export function registerEventRoutes(
  app: FastifyInstance,
  dependencies: CollectorDependencies,
): void {
  app.post("/v1/events", async (request, reply) => {
    const body = wideEventBatchSchema.parse(request.body);
    let normalized;
    try {
      normalized = normalizeEventBatchForIngest(body);
    } catch (error) {
      if (error instanceof EventNormalizationError) {
        throw new BadRequestError(error.message);
      }
      throw error;
    }

    let projectRows: ProjectEventRow[];
    try {
      projectRows = dependencies.projectRegistry.prepareProjectRows(
        normalized.projectRows,
      );
    } catch (error) {
      if (error instanceof ProjectValidationError) {
        throw new BadRequestError(error.message);
      }
      throw error;
    }

    await dependencies.store.enqueueIngestBatch({
      defaultRows: normalized.defaultRows,
      projectRows,
    });
    await reply.code(202).send({
      accepted: normalized.defaultRows.length + normalized.projectRows.length,
    });
  });
}
