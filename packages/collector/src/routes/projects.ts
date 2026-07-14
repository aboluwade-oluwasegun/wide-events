import type { FastifyInstance } from "fastify";
import { projectRoutingQuerySchema } from "@wide-events/internal";
import { BadRequestError } from "../errors.js";
import type { ProjectRoutingFilter } from "../projects/registry.js";
import type { CollectorDependencies } from "../server.js";

export function registerProjectRoutes(
  app: FastifyInstance,
  dependencies: CollectorDependencies,
): void {
  app.get("/v1/projects/config", (request) => {
    const query = projectRoutingQuerySchema.parse(request.query);
    return dependencies.projectRegistry.routingConfig({
      serviceName: resolveQueryAlias(
        query.serviceName,
        query["service.name"],
        "serviceName",
        "service.name",
      ),
      environment: resolveQueryAlias(
        query.serviceEnvironment,
        query["service.environment"],
        "serviceEnvironment",
        "service.environment",
      ),
    });
  });
}

function resolveQueryAlias(
  primary: string | undefined,
  alias: string | undefined,
  primaryName: string,
  aliasName: string,
): ProjectRoutingFilter["serviceName"] {
  if (primary && alias && primary !== alias) {
    throw new BadRequestError(
      `Conflicting project routing query params "${primaryName}" and "${aliasName}"`,
    );
  }

  return primary ?? alias ?? null;
}
