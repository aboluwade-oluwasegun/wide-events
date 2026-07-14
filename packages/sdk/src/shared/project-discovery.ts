import { z } from "zod";
import {
  projectExtractionRuleSchema,
  projectRuleFieldSchema,
  projectRuleMatchSchema,
  type ProjectExtractionRule,
} from "./project-rule-schema.js";

export interface ProjectDiscoveryClientOptions {
  apiKey?: string | undefined;
  apiUrl?: string | undefined;
  projectIds?: readonly string[] | undefined;
  fetchImpl: typeof fetch;
}

export interface ProjectDiscoveryProject {
  project_id: string;
  rule_version: string;
}

export interface ActiveProjectDiscoveryResult {
  active: true;
  rulesUrl: string;
  projects: ProjectDiscoveryProject[];
  rules: ProjectExtractionRule[];
}

export interface InactiveProjectDiscoveryResult {
  active: false;
  reason: "missing_config" | "unauthorized";
  error?: Error | undefined;
}

export type ProjectDiscoveryResult =
  | ActiveProjectDiscoveryResult
  | InactiveProjectDiscoveryResult;

const projectLocalRouteRuleSchema = z
  .object({
    match: projectRuleMatchSchema,
    fields: z.array(projectRuleFieldSchema).min(1),
  })
  .strict();

const projectLocalRulesSchema = z
  .object({
    routes: z.array(projectLocalRouteRuleSchema),
  })
  .strict();

const projectDiscoveryProjectSchema = z
  .object({
    project_id: z.string().trim().min(1),
    rule_version: z.string().trim().min(1),
    rules: projectLocalRulesSchema,
  })
  .strict();

export const projectDiscoveryResponseSchema = z
  .object({
    rulesUrl: z.url(),
    projects: z.array(projectDiscoveryProjectSchema),
  })
  .strict();

type ProjectDiscoveryResponse = z.output<typeof projectDiscoveryResponseSchema>;

export async function discoverProjectConfig(
  options: ProjectDiscoveryClientOptions,
): Promise<ProjectDiscoveryResult> {
  if (!options.apiKey || !options.apiUrl) {
    return {
      active: false,
      reason: "missing_config",
    };
  }

  const response = await options.fetchImpl(buildProjectDiscoveryUrl(options.apiUrl), {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(buildProjectDiscoveryRequestBody(options.projectIds)),
  });

  if (response.status === 401 || response.status === 403) {
    return {
      active: false,
      reason: "unauthorized",
      error: new Error(`Project discovery failed (${response.status})`),
    };
  }

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Project discovery failed (${response.status}): ${payload}`);
  }

  return parseProjectDiscoveryResponse(await response.json());
}

export function parseProjectDiscoveryResponse(
  payload: unknown,
): ActiveProjectDiscoveryResult {
  const parsed = projectDiscoveryResponseSchema.parse(payload);

  return {
    active: true,
    rulesUrl: parsed.rulesUrl,
    projects: parsed.projects.map(toProjectDiscoveryProject),
    rules: normalizeProjectDiscoveryRules(parsed),
  };
}

function buildProjectDiscoveryUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/$/u, "")}/v1/sdk/projects/discover`;
}

function buildProjectDiscoveryRequestBody(
  projectIds: readonly string[] | undefined,
): Record<string, readonly string[]> {
  return typeof projectIds === "undefined" || projectIds.length === 0
    ? {}
    : { projectIds };
}

function normalizeProjectDiscoveryRules(
  response: ProjectDiscoveryResponse,
): ProjectExtractionRule[] {
  return response.projects.flatMap((project) =>
    project.rules.routes.map((rule) =>
      projectExtractionRuleSchema.parse({
        project_id: project.project_id,
        project_rule_version: project.rule_version,
        match: rule.match,
        fields: rule.fields,
      }),
    ),
  );
}

function toProjectDiscoveryProject(
  project: ProjectDiscoveryResponse["projects"][number],
): ProjectDiscoveryProject {
  return {
    project_id: project.project_id,
    rule_version: project.rule_version,
  };
}
