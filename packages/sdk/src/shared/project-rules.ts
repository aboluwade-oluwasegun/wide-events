import {
  discoverProjectConfig,
  parseProjectDiscoveryResponse,
  type ActiveProjectDiscoveryResult,
  type ProjectDiscoveryProject,
} from "./project-discovery.js";
import {
  DEFAULT_PROJECT_RULE_REFRESH_INTERVAL_MS,
  projectRulesDocumentSchema,
  type ProjectExtractionRule,
  type ProjectRulesDocument,
} from "./project-rule-schema.js";
import type { ProjectRoutingOption } from "./projects.js";

export {
  DEFAULT_PROJECT_RULE_REFRESH_INTERVAL_MS,
  PROJECT_RULE_FIELD_SOURCES,
  projectExtractionRuleSchema,
  projectRuleFieldSchema,
  projectRuleMatchSchema,
  projectRulesConfigSchema,
  projectRulesDocumentSchema,
  type ProjectExtractionRule,
  type ProjectRuleField,
  type ProjectRuleFieldSource,
  type ProjectRuleMatch,
  type ProjectRulesConfig,
  type ProjectRulesDocument,
  type ResolvedProjectRulesConfig,
} from "./project-rule-schema.js";

export interface ProjectRulesManagerOptions {
  projects: ProjectRoutingOption;
  apiKey?: string | undefined;
  apiUrl?: string | undefined;
  fetchImpl: typeof fetch;
}

export class ProjectRulesManager {
  private cachedDiscovery: ActiveProjectDiscoveryResult | null = null;
  private nextRefreshAt = 0;
  private refreshPromise: Promise<ActiveProjectDiscoveryResult | null> | null = null;
  private refreshError: Error | null = null;

  constructor(private readonly options: ProjectRulesManagerOptions) {}

  get enabled(): boolean {
    return this.options.projects !== false;
  }

  get lastError(): Error | null {
    return this.refreshError;
  }

  currentDocument(): ProjectRulesDocument | null {
    return this.cachedDiscovery
      ? {
          version: 1,
          rules: this.cachedDiscovery.rules,
        }
      : null;
  }

  async getRules(): Promise<readonly ProjectExtractionRule[]> {
    const discovery = await this.getDiscovery();
    return discovery?.rules ?? [];
  }

  async getDocument(): Promise<ProjectRulesDocument | null> {
    const discovery = await this.getDiscovery();
    return discovery
      ? {
          version: 1,
          rules: discovery.rules,
        }
      : null;
  }

  async getProjects(): Promise<readonly ProjectDiscoveryProject[]> {
    const discovery = await this.getDiscovery();
    return discovery?.projects ?? [];
  }

  private async getDiscovery(): Promise<ActiveProjectDiscoveryResult | null> {
    if (!this.enabled) {
      return null;
    }

    const now = Date.now();
    if (now < this.nextRefreshAt) {
      return this.cachedDiscovery;
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

  private async refresh(startedAt: number): Promise<ActiveProjectDiscoveryResult | null> {
    if (!this.enabled) {
      return null;
    }

    try {
      const discovery = this.cachedDiscovery
        ? await fetchProjectDiscoveryRules(
            this.options.fetchImpl,
            this.cachedDiscovery.rulesUrl,
          )
        : await discoverProjectConfig({
            apiKey: this.options.apiKey,
            apiUrl: this.options.apiUrl,
            projectIds: this.options.projects === false ? undefined : this.options.projects.ids,
            fetchImpl: this.options.fetchImpl,
          });

      if (!discovery.active) {
        this.refreshError = discovery.error ?? null;
        return this.cachedDiscovery;
      }

      this.cachedDiscovery = discovery;
      this.refreshError = null;
      return discovery;
    } catch (error) {
      this.refreshError = toError(error);
      return this.cachedDiscovery;
    } finally {
      this.nextRefreshAt = startedAt + getProjectRuleRefreshIntervalMs(this.options.projects);
    }
  }
}

export function parseProjectRulesDocument(payload: unknown): ProjectRulesDocument {
  return projectRulesDocumentSchema.parse(payload);
}

async function fetchProjectDiscoveryRules(
  fetchImpl: typeof fetch,
  url: string,
): Promise<ActiveProjectDiscoveryResult> {
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

  return parseProjectDiscoveryResponse(await response.json());
}

function getProjectRuleRefreshIntervalMs(projects: ProjectRoutingOption): number {
  return projects === false
    ? DEFAULT_PROJECT_RULE_REFRESH_INTERVAL_MS
    : projects.refreshIntervalMs;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
