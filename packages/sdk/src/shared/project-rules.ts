import { z } from "zod";
import {
  PROJECT_EVENT_RESERVED_FIELD_NAMES,
  type ProjectFieldType,
} from "@wide-events/internal";

export const DEFAULT_PROJECT_RULE_REFRESH_INTERVAL_MS = 60_000;

export const PROJECT_RULE_FIELD_SOURCES = [
  "request.body",
  "request.query",
  "request.params",
  "request.headers",
  "response.body",
  "response.status",
] as const;

const PROJECT_FIELD_TYPES = [
  "BOOLEAN",
  "BIGINT",
  "DOUBLE",
  "VARCHAR",
  "JSON",
] as const satisfies readonly ProjectFieldType[];

const reservedProjectFieldNames: ReadonlySet<string> = new Set(
  PROJECT_EVENT_RESERVED_FIELD_NAMES,
);

export const projectRulesConfigSchema = z
  .object({
    url: z.url(),
    refreshIntervalMs: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_PROJECT_RULE_REFRESH_INTERVAL_MS),
  })
  .strict();

const projectRuleFieldSchema = z
  .object({
    field: z.string().trim().min(1),
    source: z.enum(PROJECT_RULE_FIELD_SOURCES),
    path: z.string().trim().min(1).optional(),
    type: z.enum(PROJECT_FIELD_TYPES),
    optional: z.boolean().default(false),
  })
  .strict()
  .superRefine((field, context) => {
    if (reservedProjectFieldNames.has(field.field)) {
      context.addIssue({
        code: "custom",
        path: ["field"],
        message: `Project field "${field.field}" is reserved`,
      });
    }

    if (field.source === "response.status") {
      if (typeof field.path !== "undefined") {
        context.addIssue({
          code: "custom",
          path: ["path"],
          message: "response.status rules must not define a path",
        });
      }
      return;
    }

    if (typeof field.path === "undefined") {
      context.addIssue({
        code: "custom",
        path: ["path"],
        message: `${field.source} rules require a dot path`,
      });
    }
  });

const projectRuleMatchSchema = z
  .object({
    method: z
      .string()
      .trim()
      .min(1)
      .transform((method) => method.toUpperCase()),
    path: z
      .string()
      .trim()
      .min(1)
      .refine((path) => path.startsWith("/"), {
        message: "Project rule match path must start with /",
      }),
  })
  .strict();

export const projectExtractionRuleSchema = z
  .object({
    project_id: z.string().trim().min(1),
    project_rule_version: z.string().trim().min(1),
    match: projectRuleMatchSchema,
    fields: z.array(projectRuleFieldSchema).min(1),
  })
  .strict();

export const projectRulesDocumentSchema = z
  .object({
    version: z.literal(1),
    rules: z.array(projectExtractionRuleSchema),
  })
  .strict();

export type ProjectRulesConfig = z.input<typeof projectRulesConfigSchema>;
export type ResolvedProjectRulesConfig = z.output<typeof projectRulesConfigSchema>;
export type ProjectRuleFieldSource = (typeof PROJECT_RULE_FIELD_SOURCES)[number];
export type ProjectRuleField = z.output<typeof projectRuleFieldSchema>;
export type ProjectRuleMatch = z.output<typeof projectRuleMatchSchema>;
export type ProjectExtractionRule = z.output<typeof projectExtractionRuleSchema>;
export type ProjectRulesDocument = z.output<typeof projectRulesDocumentSchema>;

export interface ProjectRulesManagerOptions {
  projectRules?: ProjectRulesConfig | undefined;
  fetchImpl: typeof fetch;
}

export class ProjectRulesManager {
  private readonly config: ResolvedProjectRulesConfig | null;
  private cachedDocument: ProjectRulesDocument | null = null;
  private nextRefreshAt = 0;
  private refreshPromise: Promise<ProjectRulesDocument | null> | null = null;
  private refreshError: Error | null = null;

  constructor(private readonly options: ProjectRulesManagerOptions) {
    this.config =
      typeof options.projectRules === "undefined"
        ? null
        : projectRulesConfigSchema.parse(options.projectRules);
  }

  get enabled(): boolean {
    return this.config !== null;
  }

  get lastError(): Error | null {
    return this.refreshError;
  }

  currentDocument(): ProjectRulesDocument | null {
    return this.cachedDocument;
  }

  async getRules(): Promise<readonly ProjectExtractionRule[]> {
    const document = await this.getDocument();
    return document?.rules ?? [];
  }

  async getDocument(): Promise<ProjectRulesDocument | null> {
    if (!this.config) {
      return null;
    }

    const now = Date.now();
    if (now < this.nextRefreshAt) {
      return this.cachedDocument;
    }

    if (this.refreshPromise) {
      return await this.refreshPromise;
    }

    const promise = this.refresh(now);
    this.refreshPromise = promise;

    try {
      return await promise;
    } finally {
      if (this.refreshPromise === promise) {
        this.refreshPromise = null;
      }
    }
  }

  private async refresh(startedAt: number): Promise<ProjectRulesDocument | null> {
    if (!this.config) {
      return null;
    }

    try {
      const payload = await fetchProjectRules(this.options.fetchImpl, this.config.url);
      const document = parseProjectRulesDocument(payload);
      this.cachedDocument = document;
      this.refreshError = null;
      return document;
    } catch (error) {
      this.refreshError = toError(error);
      return this.cachedDocument;
    } finally {
      this.nextRefreshAt = startedAt + this.config.refreshIntervalMs;
    }
  }
}

export function parseProjectRulesDocument(payload: unknown): ProjectRulesDocument {
  return projectRulesDocumentSchema.parse(payload);
}

async function fetchProjectRules(
  fetchImpl: typeof fetch,
  url: string,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Project rules fetch failed (${response.status}): ${payload}`);
  }

  return await response.json();
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
