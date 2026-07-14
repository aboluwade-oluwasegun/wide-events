import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WideEvent } from "@wide-events/internal";
import type { Cluster, Redis } from "ioredis";
import type { Pool, PoolClient } from "pg";
import {
  createExpressRequestEvent,
  extractExpressProjectMetadata,
  wrapExpressResponseBody,
} from "./express-adapter.js";
import {
  createFastifyRequestEvent,
  extractFastifyProjectMetadata,
  getFastifyStatusCode,
  normalizeFastifyPayload,
} from "./fastify-adapter.js";
import type {
  ExpressRequestLike,
  ExpressResponseLike,
  FastifyInstanceLike,
  FastifyPluginLike,
  FastifyRequestLike,
  FastifyRequestState,
  HonoContextLike,
  HonoMiddlewareLike,
  HonoNext,
  NestCallHandlerLike,
  NestExecutionContextLike,
  NestInterceptorLike,
  NestMiddlewareLike,
  NestObservableLike,
  NestObserverLike,
  NextFunction,
  RequestLike,
  ResponseLike,
} from "./framework-types.js";
import {
  createHonoRequestEvent,
  extractHonoProjectMetadata,
  findMatchingHonoProjectRule,
  getHonoStatusCode,
  isResponse,
  readHonoRequestBody,
  readHonoResponseBody,
  ruleUsesSource,
} from "./hono-adapter.js";
import { createRequestEvent } from "./http-common.js";
import { instrumentAwsSdkV3, type AwsSdkV3ClientTarget } from "./instrumentation/aws-sdk-v3.js";
import { instrumentIoredis } from "./instrumentation/ioredis.js";
import { instrumentPg } from "./instrumentation/pg.js";
import { annotateLambdaResult, createLambdaEvent } from "./lambda-adapter.js";
import {
  CoreWideEvents,
  type ContextStorage,
  type RecordErrorOptions,
  type WideEventContext,
  type WideEventSink,
} from "../shared/core.js";
import type { InstrumentationHooks } from "../shared/instrumentation/types.js";
import {
  resolveNodeOptions,
  type ResolvedWideEventsOptions,
  type WideEventsOptions,
} from "../shared/options.js";

class AsyncContextStorage implements ContextStorage {
  private readonly storage = new AsyncLocalStorage<WideEventContext>();

  getStore(): WideEventContext | undefined {
    return this.storage.getStore();
  }

  run<T>(context: WideEventContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  enterWith(context: WideEventContext): void {
    this.storage.enterWith(context);
  }
}

export interface WideEventsNodeInstrumentationOptions {
  fetch?: boolean | undefined;
  pg?: Array<Pool | PoolClient> | undefined;
  redis?: Array<Redis | Cluster> | undefined;
  aws?: AwsSdkV3ClientTarget[] | undefined;
}

export class WideEvents implements InstrumentationHooks {
  readonly options: ResolvedWideEventsOptions;
  private readonly storage = new AsyncContextStorage();
  private readonly core: CoreWideEvents;

  constructor(
    options: WideEventsOptions,
    instrumentation: WideEventsNodeInstrumentationOptions = {},
  ) {
    this.options = resolveNodeOptions(options);
    this.core = new CoreWideEvents(this.options, this.storage);
    this.applyNodeInstrumentation(instrumentation);
  }

  private applyNodeInstrumentation(instrumentation: WideEventsNodeInstrumentationOptions): void {
    const shouldInstrumentFetch = instrumentation.fetch ?? this.options.autoInstrument.fetch;
    if (shouldInstrumentFetch) {
      this.instrumentFetch();
    }

    for (const pool of instrumentation.pg ?? []) {
      instrumentPg(pool, this);
    }

    for (const client of instrumentation.redis ?? []) {
      instrumentIoredis(client, this);
    }

    for (const client of instrumentation.aws ?? []) {
      instrumentAwsSdkV3(client, this);
    }
  }

  run<T>(initial: Partial<WideEvent>, callback: () => T): T {
    return this.core.run(initial, callback);
  }

  current(): WideEvent | undefined {
    return this.core.current();
  }

  annotate: CoreWideEvents["annotate"] = (...args) => this.core.annotate(...args);
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

  middleware() {
    return (request: RequestLike, response: ResponseLike, next: NextFunction) => {
      const started = Date.now();
      const context = this.core.createContext(createRequestEvent(request));
      this.storage.run(context, () => {
        response.once("finish", () => {
          this.storage.run(context, () => {
            const statusCode = response.statusCode ?? 200;
            if (statusCode >= 500) {
              this.core.annotate({
                error: true,
                "exception.slug": `http_${statusCode}`,
              });
            }

            this.core.finishCurrent({
              "http.status_code": statusCode,
              duration_ms: Date.now() - started,
            });
            this.core.flushInBackground();
          });
        });

        next();
      });
    };
  }

  expressMiddleware() {
    return (
      request: ExpressRequestLike,
      response: ExpressResponseLike,
      next: NextFunction,
    ) => {
      this.prepareExpressMiddleware(request, response, next);
    };
  }

  private prepareExpressMiddleware(
    request: ExpressRequestLike,
    response: ExpressResponseLike,
    next: NextFunction,
  ): void {
    try {
      const rules = this.core.currentProjectRules();
      this.core.refreshProjectRules();
      const started = Date.now();
      const capture = wrapExpressResponseBody(response);
      const context = this.core.createContext(createExpressRequestEvent(request));

      this.storage.run(context, () => {
        response.once("finish", () => {
          this.storage.run(context, () => {
            const statusCode = response.statusCode ?? 200;
            if (statusCode >= 500) {
              this.core.annotate({
                error: true,
                "exception.slug": `http_${statusCode}`,
              });
            }

            const metadata = extractExpressProjectMetadata(
              rules,
              request,
              capture.body,
              statusCode,
            );
            if (metadata) {
              this.core.applyProjectMetadata(metadata);
            }

            this.core.finishCurrent({
              "http.status_code": statusCode,
              duration_ms: Date.now() - started,
            });
            this.core.flushInBackground();
          });
        });

        next();
      });
    } catch (error) {
      next(error);
    }
  }

  fastifyPlugin(): FastifyPluginLike {
    return (fastify, _options, done) => {
      try {
        this.registerFastifyHooks(fastify);
        done();
      } catch (error) {
        done(error instanceof Error ? error : new Error(String(error)));
      }
    };
  }

  private registerFastifyHooks(fastify: FastifyInstanceLike): void {
    const states = new WeakMap<FastifyRequestLike, FastifyRequestState>();

    fastify.addHook("onRequest", (request, _reply) => {
      const rules = this.core.currentProjectRules();
      this.core.refreshProjectRules();
      states.set(request, {
        context: this.core.createContext(createFastifyRequestEvent(request)),
        rules,
        started: Date.now(),
        responseBody: undefined,
        hasResponseBody: false,
      });
    });

    fastify.addHook("preHandler", (request, _reply, done) => {
      const state = states.get(request);
      if (!state) {
        done();
        return;
      }

      this.storage.enterWith(state.context);
      done();
    });

    fastify.addHook("preSerialization", (request, _reply, payload, done) => {
      const state = states.get(request);
      if (state) {
        state.responseBody = payload;
        state.hasResponseBody = true;
      }

      done(null, payload);
    });

    fastify.addHook("onSend", (request, _reply, payload, done) => {
      const state = states.get(request);
      if (state && !state.hasResponseBody) {
        state.responseBody = normalizeFastifyPayload(payload);
        state.hasResponseBody = true;
      }

      done(null, payload);
    });

    fastify.addHook("onResponse", (request, reply) => {
      const state = states.get(request);
      if (!state) {
        return;
      }

      states.delete(request);
      this.storage.run(state.context, () => {
        const statusCode = getFastifyStatusCode(reply);
        if (statusCode >= 500) {
          this.core.annotate({
            error: true,
            "exception.slug": `http_${statusCode}`,
          });
        }

        const metadata = extractFastifyProjectMetadata(
          state.rules,
          request,
          state.responseBody,
          statusCode,
        );
        if (metadata) {
          this.core.applyProjectMetadata(metadata);
        }

        this.core.finishCurrent({
          "http.status_code": statusCode,
          duration_ms: Date.now() - state.started,
        });
        this.core.flushInBackground();
      });
    });
  }

  honoMiddleware(): HonoMiddlewareLike {
    return async (context, next) => await this.prepareHonoMiddleware(context, next);
  }

  private async prepareHonoMiddleware(
    context: HonoContextLike,
    next: HonoNext,
  ): Promise<Response | void> {
    const rules = this.core.currentProjectRules();
    this.core.refreshProjectRules();
    const request = context.req;
    const matchingRule = findMatchingHonoProjectRule(rules, request);
    const requestBody = ruleUsesSource(matchingRule, "request.body")
      ? await readHonoRequestBody(request)
      : request.body;
    const started = Date.now();
    const wideContext = this.core.createContext(createHonoRequestEvent(request));

    return await this.storage.run(wideContext, async () => {
      const nextResult = await next();
      const response = isResponse(nextResult) ? nextResult : context.res;
      const statusCode = getHonoStatusCode(response);
      if (statusCode >= 500) {
        this.core.annotate({
          error: true,
          "exception.slug": `http_${statusCode}`,
        });
      }

      const responseBody = ruleUsesSource(matchingRule, "response.body")
        ? await readHonoResponseBody(response)
        : undefined;
      const metadata = extractHonoProjectMetadata(
        rules,
        request,
        requestBody,
        responseBody,
        statusCode,
      );
      if (metadata) {
        this.core.applyProjectMetadata(metadata);
      }

      this.core.finishCurrent({
        "http.status_code": statusCode,
        duration_ms: Date.now() - started,
      });
      this.core.flushInBackground();

      return nextResult;
    });
  }

  nestMiddleware(): NestMiddlewareLike {
    return this.expressMiddleware();
  }

  nestInterceptor<TResult = unknown>(): NestInterceptorLike<TResult> {
    return {
      intercept: async (context, next) =>
        await this.prepareNestInterceptor<TResult>(context, next),
    };
  }

  private async prepareNestInterceptor<TResult>(
    context: NestExecutionContextLike,
    next: NestCallHandlerLike<TResult>,
  ): Promise<NestObservableLike<TResult>> {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();
    const rules = this.core.currentProjectRules();
    this.core.refreshProjectRules();
    const started = Date.now();
    const wideContext = this.core.createContext(createExpressRequestEvent(request));
    const source = await this.storage.run(wideContext, async () => await next.handle());

    let responseBody: unknown;
    let finished = false;
    const finish = (error?: unknown): void => {
      if (finished) {
        return;
      }

      finished = true;
      this.storage.run(wideContext, () => {
        const statusCode = response.statusCode ?? 200;
        if (typeof error !== "undefined") {
          this.core.recordError(error, { handled: false });
        } else if (statusCode >= 500) {
          this.core.annotate({
            error: true,
            "exception.slug": `http_${statusCode}`,
          });
        }

        const metadata = extractExpressProjectMetadata(
          rules,
          request,
          responseBody,
          statusCode,
        );
        if (metadata) {
          this.core.applyProjectMetadata(metadata);
        }

        this.core.finishCurrent({
          "http.status_code": statusCode,
          duration_ms: Date.now() - started,
        });
        this.core.flushInBackground();
      });
    };

    return wrapNestObservable(
      source,
      (callback) => this.storage.run(wideContext, callback),
      (value) => {
        responseBody = value;
      },
      finish,
      () => finish(),
    );
  }

  route<TRequest extends IncomingMessage, TResponse extends ServerResponse>(
    handler: (request: TRequest, response: TResponse) => Promise<void> | void,
  ) {
    return (request: TRequest, response: TResponse, next?: NextFunction) => {
      const middleware = this.middleware();
      middleware(request, response, () => {
        void Promise.resolve()
          .then(() => handler(request, response))
          .catch((error: unknown) => {
            this.core.recordError(error, { handled: false });
            if (next) {
              next(error);
              return;
            }
            throw error;
          });
      });
    };
  }

  wrapHandler<TEvent, TContext, TResult>(
    handler: (event: TEvent, context: TContext) => Promise<TResult> | TResult,
  ) {
    return async (event: TEvent, context: TContext): Promise<TResult> =>
      await this.core.run(createLambdaEvent(event), async () => {
        try {
          const result = await handler(event, context);
          annotateLambdaResult(this.core, result);
          return result;
        } catch (error) {
          this.core.recordError(error, { handled: false });
          throw error;
        } finally {
          this.core.finishCurrent();
          await this.core.flush();
        }
      });
  }

  async forceFlush(): Promise<void> {
    await this.core.flush();
  }

  async flush(): Promise<void> {
    await this.core.flush();
  }

  async shutdown(): Promise<void> {
    this.core.restoreFetch();
    await this.core.shutdown();
  }
}

export function createWideEvents(
  options: WideEventsOptions,
  instrumentation?: WideEventsNodeInstrumentationOptions,
): WideEvents {
  return new WideEvents(options, instrumentation);
}

type NestContextRunner = <TResult>(callback: () => TResult) => TResult;
type NestObservableOperator = (
  source: NestObservableLike<unknown>,
) => NestObservableLike<unknown>;

function wrapNestObservable<TResult>(
  source: NestObservableLike<TResult>,
  runInContext: NestContextRunner,
  onNext: (value: TResult) => void,
  onError: (error: unknown) => void,
  onComplete: () => void,
): NestObservableLike<TResult> & {
  pipe(...operators: NestObservableOperator[]): NestObservableLike<unknown>;
} {
  const wrapped: NestObservableLike<TResult> & {
    pipe(...operators: NestObservableOperator[]): NestObservableLike<unknown>;
  } = {
    subscribe(observerOrNext, error, complete) {
      const observer = normalizeNestObserver(observerOrNext, error, complete);
      return runInContext(() =>
        source.subscribe({
          next(value) {
            runInContext(() => {
              onNext(value);
              observer.next?.(value);
            });
          },
          error(cause) {
            runInContext(() => {
              onError(cause);
              observer.error?.(cause);
            });
          },
          complete() {
            runInContext(() => {
              onComplete();
              observer.complete?.();
            });
          },
        }),
      );
    },
    pipe(...operators) {
      return operators.reduce<NestObservableLike<unknown>>(
        (current, operator) => operator(current),
        wrapped as NestObservableLike<unknown>,
      );
    },
  };

  return wrapped;
}

function normalizeNestObserver<TResult>(
  observerOrNext?: NestObserverLike<TResult> | ((value: TResult) => void),
  error?: (error: unknown) => void,
  complete?: () => void,
): NestObserverLike<TResult> {
  if (typeof observerOrNext === "function") {
    return {
      next: observerOrNext,
      error,
      complete,
    };
  }

  return {
    next: observerOrNext?.next,
    error: observerOrNext?.error ?? error,
    complete: observerOrNext?.complete ?? complete,
  };
}

export type { WideEventsOptions, WideEventSink, RecordErrorOptions };
export type { InstrumentationHooks } from "../shared/instrumentation/types.js";
export type {
  ExpressRequestLike,
  ExpressResponseLike,
  FastifyDone,
  FastifyInstanceLike,
  FastifyPayloadDone,
  FastifyPluginLike,
  FastifyReplyLike,
  FastifyRequestLike,
  HonoContextLike,
  HonoMiddlewareLike,
  HonoNext,
  HonoRequestLike,
  NestCallHandlerLike,
  NestExecutionContextLike,
  NestHttpArgumentsHostLike,
  NestInterceptorLike,
  NestMiddlewareLike,
  NestNextFunction,
  NestObservableLike,
  NestObserverLike,
  NestTeardownLike,
} from "./framework-types.js";
export type {
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
  ProjectRulesDocument,
} from "../shared/project-rules.js";
export type {
  ProjectExtractionContext,
  ProjectExtractionMetadata,
  ProjectExtractionRequest,
  ProjectExtractionResponse,
} from "../shared/project-extraction.js";
