import type {
  ProjectEventRow,
  ProjectRoutingConfig,
  ProjectRoutingConfigResponse,
} from "@wide-events/internal";
import type { CollectorConfig } from "../config.js";

type CollectorProjectConfig = CollectorConfig["projects"][number];

export interface ProjectRoutingFilter {
  serviceName: string | null;
  environment: string | null;
}

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

export class ProjectRegistry {
  private readonly projectsById = new Map<string, CollectorProjectConfig>();

  constructor(
    projects: readonly CollectorProjectConfig[],
    private readonly ttlSeconds: number,
  ) {
    for (const project of projects) {
      if (this.projectsById.has(project.projectId)) {
        throw new Error(`Duplicate projectId "${project.projectId}"`);
      }
      this.projectsById.set(project.projectId, project);
    }
  }

  routingConfig(filter: ProjectRoutingFilter): ProjectRoutingConfigResponse {
    const projects = [...this.projectsById.values()]
      .filter((project) => project.active)
      .filter((project) => matchesFilter(project, filter))
      .map(toRoutingConfig);

    return {
      ttl_seconds: this.ttlSeconds,
      projects,
    };
  }

  prepareProjectRows(rows: readonly ProjectEventRow[]): ProjectEventRow[] {
    return rows.map((row) => this.prepareProjectRow(row));
  }

  private prepareProjectRow(row: ProjectEventRow): ProjectEventRow {
    const project = this.projectsById.get(row.project_id);
    if (!project) {
      throw new ProjectValidationError(`Unknown project_id "${row.project_id}"`);
    }

    if (!project.active) {
      throw new ProjectValidationError(`Project "${row.project_id}" is not active`);
    }

    if (
      project.serviceName !== null &&
      row["service.name"] !== project.serviceName
    ) {
      throw new ProjectValidationError(
        `Project "${row.project_id}" does not match service.name`,
      );
    }

    if (
      project.environment !== null &&
      row["service.environment"] !== project.environment
    ) {
      throw new ProjectValidationError(
        `Project "${row.project_id}" does not match service.environment`,
      );
    }

    if (row.project_rule_version) {
      return row;
    }

    return {
      ...row,
      project_rule_version: project.ruleVersion,
    };
  }
}

function matchesFilter(
  project: CollectorProjectConfig,
  filter: ProjectRoutingFilter,
): boolean {
  if (
    filter.serviceName !== null &&
    project.serviceName !== null &&
    project.serviceName !== filter.serviceName
  ) {
    return false;
  }

  if (
    filter.environment !== null &&
    project.environment !== null &&
    project.environment !== filter.environment
  ) {
    return false;
  }

  return true;
}

function toRoutingConfig(project: CollectorProjectConfig): ProjectRoutingConfig {
  return {
    project_id: project.projectId,
    project_rule_version: project.ruleVersion,
    service_name: project.serviceName,
    environment: project.environment,
  };
}
