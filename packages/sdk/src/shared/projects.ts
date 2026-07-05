import {
  PROJECT_EVENT_RESERVED_FIELD_NAMES,
  normalizeEventPrimitive,
  type EventValue,
  type ProjectFieldType,
  type ProjectFieldTypes,
  type ProjectFields,
  type WideEvent,
} from "@wide-events/internal";

export interface ProjectRoutingConfigOption {
  ids?: readonly string[] | undefined;
  refreshIntervalMs: number;
}

export type ProjectRoutingOption = false | ProjectRoutingConfigOption;

export type ProjectAnnotationFields = Record<string, unknown>;

const RESERVED_PROJECT_FIELD_NAMES: ReadonlySet<string> = new Set(
  PROJECT_EVENT_RESERVED_FIELD_NAMES,
);

export interface AnnotateProjectOptions<
  TFields extends ProjectAnnotationFields = ProjectAnnotationFields,
> {
  projectId?: string | undefined;
  projectRuleVersion?: string | undefined;
  fieldTypes?: Partial<Record<Extract<keyof TFields, string>, ProjectFieldType>> | undefined;
}

interface ProjectRoute {
  projectId: string;
  projectRuleVersion: string | null;
}

export interface ProjectRoutingManagerOptions {
  projects: ProjectRoutingOption;
  resolveProjects?: (() => Promise<readonly ProjectRoutingProject[]>) | undefined;
}

export interface ProjectRoutingProject {
  project_id: string;
  rule_version: string;
}

export class ProjectRoutingManager {
  constructor(private readonly options: ProjectRoutingManagerOptions) {}

  get enabled(): boolean {
    return this.options.projects !== false;
  }

  prepareProjectAnnotation<TFields extends ProjectAnnotationFields>(
    fields: TFields,
    options: AnnotateProjectOptions<TFields> = {},
  ): Pick<WideEvent, "project_fields" | "project_field_types" | "project_id" | "project_rule_version"> {
    if (!this.enabled) {
      throw new Error("annotateProject() requires the SDK projects option to be enabled");
    }

    const normalizedFields: ProjectFields = {};
    const fieldTypes: ProjectFieldTypes = {};

    for (const [key, rawValue] of Object.entries(fields)) {
      if (RESERVED_PROJECT_FIELD_NAMES.has(key)) {
        throw new Error(`Project field "${key}" is reserved`);
      }

      const value = normalizeEventPrimitive(rawValue);
      normalizedFields[key] = value;
      fieldTypes[key] = options.fieldTypes?.[key] ?? inferProjectFieldType(value);
    }

    return {
      project_id: options.projectId,
      project_rule_version: options.projectRuleVersion,
      project_fields: normalizedFields,
      project_field_types: fieldTypes,
    };
  }

  async prepareEvents(events: readonly WideEvent[]): Promise<WideEvent[]> {
    if (!events.some(hasProjectMetadata)) {
      return [...events];
    }

    if (!this.enabled) {
      throw new Error("Project events require the SDK projects option to be enabled");
    }

    const routes = await this.resolveRoutes();
    const prepared: WideEvent[] = [];

    for (const event of events) {
      if (!hasProjectMetadata(event)) {
        prepared.push(event);
        continue;
      }

      if (!event.project_fields) {
        throw new Error("Project events require project_fields");
      }

      if (!event.project_field_types) {
        throw new Error("Project events require project_field_types");
      }

      if (event.project_id) {
        const route = routes.find((candidate) => candidate.projectId === event.project_id);
        if (!route) {
          throw new Error(`Project "${event.project_id}" is not configured for this SDK instance`);
        }
        prepared.push(applyProjectRoute(event, route));
        continue;
      }

      if (routes.length === 0) {
        throw new Error("No active projects are configured for this SDK instance");
      }

      for (const route of routes) {
        prepared.push(applyProjectRoute(event, route));
      }
    }

    return prepared;
  }

  private async resolveRoutes(): Promise<ProjectRoute[]> {
    if (this.options.projects === false) {
      return [];
    }

    const projects = (await this.options.resolveProjects?.()) ?? [];
    return projects.map(toProjectRoute);
  }
}

function applyProjectRoute(event: WideEvent, route: ProjectRoute): WideEvent {
  return {
    ...event,
    project_id: route.projectId,
    project_rule_version: event.project_rule_version ?? route.projectRuleVersion ?? undefined,
  };
}

function toProjectRoute(project: ProjectRoutingProject): ProjectRoute {
  return {
    projectId: project.project_id,
    projectRuleVersion: project.rule_version,
  };
}

function hasProjectMetadata(event: WideEvent): boolean {
  return (
    typeof event.project_id !== "undefined" ||
    typeof event.project_rule_version !== "undefined" ||
    typeof event.project_fields !== "undefined" ||
    typeof event.project_field_types !== "undefined"
  );
}

function inferProjectFieldType(value: EventValue): ProjectFieldType {
  if (value === null) {
    return "JSON";
  }

  switch (typeof value) {
    case "boolean":
      return "BOOLEAN";
    case "number":
      return Number.isInteger(value) ? "BIGINT" : "DOUBLE";
    case "string":
      return "VARCHAR";
    case "object":
      return "JSON";
    default:
      return "JSON";
  }
}
