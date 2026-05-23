import type { FastifyInstance } from "fastify";
import { sqlRequestSchema } from "@wide-events/internal";
import { BadRequestError } from "../errors.js";
import { assertReadOnlySql } from "../query/build-query.js";
import type { CollectorDependencies } from "../server.js";

export function registerSqlRoutes(
  app: FastifyInstance,
  dependencies: CollectorDependencies
): void {
  app.post("/sql", async (request) => {
    const { sql } = sqlRequestSchema.parse(request.body);
    assertReadOnlySql(sql);
    let rows;
    try {
      rows = await dependencies.database.executeRead(sql);
    } catch (error) {
      if (error instanceof Error) {
        throw new BadRequestError(error.message);
      }
      throw error;
    }
    return { rows };
  });
}
