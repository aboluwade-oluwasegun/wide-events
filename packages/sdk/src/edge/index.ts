import type { WideEvent } from "@wide-events/internal";
import {
  CoreWideEvents,
  type ContextStorage,
  type RecordErrorOptions,
  type WideEventContext,
  type WideEventSink,
} from "../shared/core.js";
import {
  edgeOptionsSchema,
  type EdgeWideEventsOptions,
  type ResolvedEdgeWideEventsOptions,
} from "../shared/options.js";

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

class SingleContextStorage implements ContextStorage {
  private context: WideEventContext | undefined;

  getStore(): WideEventContext | undefined {
    return this.context;
  }

  run<T>(context: WideEventContext, callback: () => T): T {
    this.context = context;
    return callback();
  }

  clear(): void {
    this.context = undefined;
  }
}

export class WideEvents {
  readonly options: ResolvedEdgeWideEventsOptions;
  private readonly storage = new SingleContextStorage();
  private readonly core: CoreWideEvents;

  constructor(options: EdgeWideEventsOptions) {
    this.options = {
      ...edgeOptionsSchema.parse(options),
      fetchImpl: options.fetchImpl,
      sink: options.sink,
    };
    this.core = new CoreWideEvents(this.options, this.storage);

    if (this.options.autoInstrument.fetch) {
      this.core.instrumentFetch();
    }
  }

  run<T>(initial: Partial<WideEvent>, callback: () => T): T {
    return this.core.run(initial, callback);
  }

  current(): WideEvent | undefined {
    return this.core.current();
  }

  annotate: CoreWideEvents["annotate"] = (...args) => this.core.annotate(...args);
  annotateProject: CoreWideEvents["annotateProject"] = (...args) =>
    this.core.annotateProject(...args);
  push: CoreWideEvents["push"] = (...args) => this.core.push(...args);
  recordError: CoreWideEvents["recordError"] = (...args) => this.core.recordError(...args);
  wrapFetch: CoreWideEvents["wrapFetch"] = (...args) => this.core.wrapFetch(...args);
  getProjectRules: CoreWideEvents["getProjectRules"] = (...args) =>
    this.core.getProjectRules(...args);
  instrumentFetch(): void {
    this.core.instrumentFetch();
  }
  restoreFetch(): void {
    this.core.restoreFetch();
  }

  fetchHandler(
    request: Request,
    executionContext: ExecutionContextLike,
    handler: (request: Request) => Promise<Response> | Response,
  ): Promise<Response> {
    const started = Date.now();
    return this.core.run(createRequestEvent(request), async () => {
      try {
        const response = await handler(request);
        this.core.finishCurrent({
          "http.status_code": response.status,
          duration_ms: Date.now() - started,
          error: response.status >= 500 ? true : null,
          "exception.slug": response.status >= 500 ? `http_${response.status}` : null,
        });
        executionContext.waitUntil(this.core.flush());
        return response;
      } catch (error) {
        this.core.recordError(error, { handled: false });
        this.core.finishCurrent({ duration_ms: Date.now() - started });
        executionContext.waitUntil(this.core.flush());
        throw error;
      } finally {
        this.storage.clear();
      }
    });
  }

  async flush(): Promise<void> {
    this.core.finishCurrent();
    await this.core.flush();
    this.storage.clear();
  }

  async shutdown(): Promise<void> {
    this.core.restoreFetch();
    await this.core.shutdown();
  }
}

export function createWideEvents(options: EdgeWideEventsOptions): WideEvents {
  return new WideEvents(options);
}

function createRequestEvent(request: Request): Partial<WideEvent> {
  const url = new URL(request.url);
  return {
    type: "request",
    name: `${request.method} ${url.pathname}`,
    "http.request.method": request.method,
    "http.route": url.pathname,
  };
}

export type { EdgeWideEventsOptions, WideEventSink, RecordErrorOptions };
export type {
  AnnotateProjectOptions,
  ProjectAnnotationFields,
  ProjectRoutingOption,
} from "../shared/projects.js";
export {
  ProjectRulesManager,
  parseProjectRulesDocument,
} from "../shared/project-rules.js";
export {
  extractProjectMetadata,
  findMatchingProjectRule,
} from "../shared/project-extraction.js";
export type {
  ProjectExtractionRule,
  ProjectRuleField,
  ProjectRuleFieldSource,
  ProjectRuleMatch,
  ProjectRulesConfig,
  ProjectRulesDocument,
} from "../shared/project-rules.js";
export type {
  ProjectExtractionContext,
  ProjectExtractionMetadata,
  ProjectExtractionRequest,
  ProjectExtractionResponse,
} from "../shared/project-extraction.js";
