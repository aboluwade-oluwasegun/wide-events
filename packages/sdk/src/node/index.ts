import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WideEvent } from "@wide-events/internal";
import type { Cluster, Redis } from "ioredis";
import type { Pool, PoolClient } from "pg";
import { instrumentAwsSdkV3, type AwsSdkV3ClientTarget } from "./instrumentation/aws-sdk-v3.js";
import { instrumentIoredis } from "./instrumentation/ioredis.js";
import { instrumentPg } from "./instrumentation/pg.js";
import {
  CoreWideEvents,
  type ContextStorage,
  type RecordErrorOptions,
  type WideEventContext,
  type WideEventSink,
} from "../shared/core.js";
import type { InstrumentationHooks } from "../shared/instrumentation/types.js";
import {
  extractProjectMetadata,
  findMatchingProjectRule,
} from "../shared/project-extraction.js";
import type { ProjectExtractionRule } from "../shared/project-rules.js";
import {
  resolveNodeOptions,
  type ResolvedWideEventsOptions,
  type WideEventsOptions,
} from "../shared/options.js";

type NextFunction = (error?: unknown) => void;

interface RequestLike {
  method?: string | undefined;
  url?: string | undefined;
  headers?: Record<string, string | string[] | undefined> | undefined;
}

interface ResponseLike {
  statusCode?: number | undefined;
  once(event: "finish", listener: () => void): unknown;
}

export interface ExpressRequestLike extends RequestLike {
  originalUrl?: string | undefined;
  path?: string | undefined;
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

export interface ExpressResponseLike extends ResponseLike {
  json?: ((body: unknown) => unknown) | undefined;
  send?: ((body?: unknown) => unknown) | undefined;
}

export interface FastifyRequestLike {
  method?: string | undefined;
  url?: string | undefined;
  routeOptions?: { url?: string | undefined } | undefined;
  routerPath?: string | undefined;
  body?: unknown;
  query?: unknown;
  params?: unknown;
  headers?: Record<string, unknown> | undefined;
}

export interface FastifyReplyLike {
  statusCode?: number | undefined;
  raw?: { statusCode?: number | undefined } | undefined;
}

export type FastifyDone = (error?: Error) => void;
export type FastifyPayloadDone = (error: Error | null, payload?: unknown) => void;

export interface FastifyInstanceLike {
  addHook(
    name: "onRequest" | "onResponse",
    hook: (
      request: FastifyRequestLike,
      reply: FastifyReplyLike,
    ) => Promise<void> | void,
  ): unknown;
  addHook(
    name: "preHandler",
    hook: (
      request: FastifyRequestLike,
      reply: FastifyReplyLike,
      done: FastifyDone,
    ) => void,
  ): unknown;
  addHook(
    name: "preSerialization" | "onSend",
    hook: (
      request: FastifyRequestLike,
      reply: FastifyReplyLike,
      payload: unknown,
      done: FastifyPayloadDone,
    ) => void,
  ): unknown;
}

export type FastifyPluginLike = (
  fastify: FastifyInstanceLike,
  options: unknown,
  done: FastifyDone,
) => void;

interface FastifyRequestState {
  context: WideEventContext;
  rules: readonly ProjectExtractionRule[];
  started: number;
  responseBody: unknown;
  hasResponseBody: boolean;
}

export interface HonoRequestLike {
  raw?: Request | undefined;
  method?: string | undefined;
  path?: string | undefined;
  body?: unknown;
  query?: ((name?: string) => unknown) | undefined;
  param?: ((name?: string) => unknown) | undefined;
  header?: ((name?: string) => unknown) | undefined;
}

export interface HonoContextLike {
  req: HonoRequestLike;
  res?: Response | undefined;
}

export type HonoNext = () => Promise<Response | void> | Response | void;
export type HonoMiddlewareLike = (
  context: HonoContextLike,
  next: HonoNext,
) => Promise<Response | void>;

export type NestNextFunction = (error?: unknown) => void;

export type NestMiddlewareLike = (
  request: ExpressRequestLike,
  response: ExpressResponseLike,
  next: NestNextFunction,
) => void;

export interface NestHttpArgumentsHostLike {
  getRequest<TRequest extends ExpressRequestLike = ExpressRequestLike>(): TRequest;
  getResponse<TResponse extends ExpressResponseLike = ExpressResponseLike>(): TResponse;
}

export interface NestExecutionContextLike {
  switchToHttp(): NestHttpArgumentsHostLike;
}

export interface NestObserverLike<TResult = unknown> {
  next?: ((value: TResult) => void) | undefined;
  error?: ((error: unknown) => void) | undefined;
  complete?: (() => void) | undefined;
}

export type NestTeardownLike =
  | (() => void)
  | { unsubscribe(): void }
  | void;

export interface NestObservableLike<TResult = unknown> {
  subscribe(
    observerOrNext?: NestObserverLike<TResult> | ((value: TResult) => void),
    error?: (error: unknown) => void,
    complete?: () => void,
  ): NestTeardownLike;
}

export interface NestCallHandlerLike<TResult = unknown> {
  handle(): NestObservableLike<TResult> | Promise<NestObservableLike<TResult>>;
}

export interface NestInterceptorLike<TResult = unknown> {
  intercept(
    context: NestExecutionContextLike,
    next: NestCallHandlerLike<TResult>,
  ): Promise<NestObservableLike<TResult>>;
}

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
            void this.core.flush();
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
      void this.prepareExpressMiddleware(request, response, next);
    };
  }

  private async prepareExpressMiddleware(
    request: ExpressRequestLike,
    response: ExpressResponseLike,
    next: NextFunction,
  ): Promise<void> {
    try {
      const rules = await this.core.getProjectRules();
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
            void this.core.flush();
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

    fastify.addHook("onRequest", async (request, _reply) => {
      const rules = await this.core.getProjectRules();
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
        void this.core.flush();
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
    const rules = await this.core.getProjectRules();
    const request = context.req;
    const method = getHonoMethod(request);
    const path = getHonoPath(request);
    const matchingRule = findMatchingProjectRule(rules, { method, path });
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
      void this.core.flush();

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
    const rules = await this.core.getProjectRules();
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
        void this.core.flush();
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

function createRequestEvent(request: RequestLike): Partial<WideEvent> {
  const url = request.url ?? "/";
  return {
    type: "request",
    name: `${request.method ?? "GET"} ${getPathname(url)}`,
    "http.request.method": request.method ?? "GET",
    "http.route": getPathname(url),
  };
}

function createExpressRequestEvent(request: ExpressRequestLike): Partial<WideEvent> {
  const method = request.method ?? "GET";
  const path = getExpressPath(request);
  return {
    type: "request",
    name: `${method} ${path}`,
    "http.request.method": method,
    "http.route": path,
  };
}

function extractExpressProjectMetadata(
  rules: readonly ProjectExtractionRule[],
  request: ExpressRequestLike,
  responseBody: unknown,
  statusCode: number,
) {
  return extractProjectMetadata(rules, {
    request: {
      method: request.method ?? "GET",
      path: getExpressPath(request),
      body: request.body,
      query: request.query,
      params: request.params,
      headers: request.headers,
    },
    response: {
      body: responseBody,
      status: statusCode,
    },
  });
}

function createFastifyRequestEvent(request: FastifyRequestLike): Partial<WideEvent> {
  const method = request.method ?? "GET";
  const path = getFastifyPath(request);
  return {
    type: "request",
    name: `${method} ${path}`,
    "http.request.method": method,
    "http.route": path,
  };
}

function extractFastifyProjectMetadata(
  rules: readonly ProjectExtractionRule[],
  request: FastifyRequestLike,
  responseBody: unknown,
  statusCode: number,
) {
  return extractProjectMetadata(rules, {
    request: {
      method: request.method ?? "GET",
      path: getFastifyPath(request),
      body: request.body,
      query: request.query,
      params: request.params,
      headers: request.headers,
    },
    response: {
      body: responseBody,
      status: statusCode,
    },
  });
}

function createHonoRequestEvent(request: HonoRequestLike): Partial<WideEvent> {
  const method = getHonoMethod(request);
  const path = getHonoPath(request);
  return {
    type: "request",
    name: `${method} ${path}`,
    "http.request.method": method,
    "http.route": path,
  };
}

function extractHonoProjectMetadata(
  rules: readonly ProjectExtractionRule[],
  request: HonoRequestLike,
  requestBody: unknown,
  responseBody: unknown,
  statusCode: number,
) {
  return extractProjectMetadata(rules, {
    request: {
      method: getHonoMethod(request),
      path: getHonoPath(request),
      body: requestBody,
      query: getHonoQuery(request),
      params: getHonoParams(request),
      headers: getHonoHeaders(request),
    },
    response: {
      body: responseBody,
      status: statusCode,
    },
  });
}

function wrapExpressResponseBody(response: ExpressResponseLike): { body: unknown } {
  const capture: { body: unknown; lockedByJson: boolean } = {
    body: undefined,
    lockedByJson: false,
  };
  const originalJson = response.json;
  const originalSend = response.send;

  if (originalJson) {
    response.json = function json(this: ExpressResponseLike, body: unknown): unknown {
      capture.body = body;
      capture.lockedByJson = true;
      return originalJson.call(this, body);
    };
  }

  if (originalSend) {
    response.send = function send(this: ExpressResponseLike, body?: unknown): unknown {
      if (!capture.lockedByJson) {
        capture.body = body;
      }
      return originalSend.call(this, body);
    };
  }

  return capture;
}

function createLambdaEvent(event: unknown): Partial<WideEvent> {
  const record = isRecord(event) ? event : {};
  const requestContext = isRecord(record["requestContext"])
    ? record["requestContext"]
    : {};
  const http = isRecord(requestContext["http"]) ? requestContext["http"] : {};
  return {
    type: "lambda",
    name: "lambda invocation",
    "http.request.method": typeof http["method"] === "string" ? http["method"] : null,
    "http.route": typeof record["rawPath"] === "string" ? record["rawPath"] : null,
    attributes: {
      "lambda.request_id":
        typeof requestContext["requestId"] === "string"
          ? requestContext["requestId"]
          : null,
    },
  };
}

function annotateLambdaResult(core: CoreWideEvents, result: unknown): void {
  if (!isRecord(result) || typeof result["statusCode"] !== "number") {
    return;
  }

  const statusCode = result["statusCode"];
  core.annotate({
    "http.status_code": statusCode,
    error: statusCode >= 500,
    "exception.slug": statusCode >= 500 ? `http_${statusCode}` : undefined,
  });
}

function getPathname(value: string): string {
  try {
    return new URL(value, "http://localhost").pathname;
  } catch {
    return value;
  }
}

function getExpressPath(request: ExpressRequestLike): string {
  if (typeof request.path === "string") {
    return request.path;
  }

  return getPathname(request.originalUrl ?? request.url ?? "/");
}

function getFastifyPath(request: FastifyRequestLike): string {
  if (typeof request.routeOptions?.url === "string") {
    return request.routeOptions.url;
  }

  if (typeof request.routerPath === "string") {
    return request.routerPath;
  }

  return getPathname(request.url ?? "/");
}

function getFastifyStatusCode(reply: FastifyReplyLike): number {
  return reply.statusCode ?? reply.raw?.statusCode ?? 200;
}

function normalizeFastifyPayload(payload: unknown): unknown {
  if (typeof payload !== "string") {
    return payload;
  }

  const trimmed = payload.trim();
  if (
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return payload;
  }

  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return payload;
  }
}

function getHonoMethod(request: HonoRequestLike): string {
  return request.method ?? request.raw?.method ?? "GET";
}

function getHonoPath(request: HonoRequestLike): string {
  if (typeof request.path === "string") {
    return request.path;
  }

  if (typeof request.raw?.url === "string") {
    return getPathname(request.raw.url);
  }

  return "/";
}

function getHonoQuery(request: HonoRequestLike): unknown {
  const query = callHonoAccessor(request.query);
  if (typeof query !== "undefined") {
    return query;
  }

  if (typeof request.raw?.url !== "string") {
    return undefined;
  }

  try {
    return urlSearchParamsToRecord(new URL(request.raw.url).searchParams);
  } catch {
    return undefined;
  }
}

function getHonoParams(request: HonoRequestLike): unknown {
  return callHonoAccessor(request.param);
}

function getHonoHeaders(request: HonoRequestLike): Headers | Record<string, unknown> | undefined {
  const headers = callHonoAccessor(request.header);
  if (isRecord(headers)) {
    return headers;
  }

  return request.raw?.headers;
}

function getHonoStatusCode(response: Response | undefined): number {
  return response?.status ?? 200;
}

function ruleUsesSource(
  rule: ProjectExtractionRule | null,
  source: ProjectExtractionRule["fields"][number]["source"],
): boolean {
  return rule?.fields.some((field) => field.source === source) ?? false;
}

async function readHonoRequestBody(request: HonoRequestLike): Promise<unknown> {
  if (typeof request.body !== "undefined") {
    return request.body;
  }

  const raw = request.raw;
  if (!raw || raw.bodyUsed) {
    return undefined;
  }

  try {
    return await readFetchBody(raw.clone(), raw.headers);
  } catch {
    return undefined;
  }
}

async function readHonoResponseBody(response: Response | undefined): Promise<unknown> {
  if (!response || response.bodyUsed) {
    return undefined;
  }

  try {
    return await readFetchBody(response.clone(), response.headers);
  } catch {
    return undefined;
  }
}

async function readFetchBody(
  body: Pick<Request, "json" | "text"> | Pick<Response, "json" | "text">,
  headers: Headers,
): Promise<unknown> {
  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    return await body.json();
  }

  const text = await body.text();
  return parseJsonLikeText(text);
}

function parseJsonLikeText(text: string): unknown {
  const trimmed = text.trim();
  if (
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return text;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return text;
  }
}

function callHonoAccessor(
  accessor: ((name?: string) => unknown) | undefined,
): unknown {
  if (!accessor) {
    return undefined;
  }

  try {
    return accessor();
  } catch {
    return undefined;
  }
}

function urlSearchParamsToRecord(params: URLSearchParams): Record<string, string | string[]> {
  const record: Record<string, string | string[]> = {};
  for (const [key, value] of params) {
    const existing = record[key];
    if (typeof existing === "undefined") {
      record[key] = value;
    } else if (Array.isArray(existing)) {
      record[key] = [...existing, value];
    } else {
      record[key] = [existing, value];
    }
  }

  return record;
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

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type { WideEventsOptions, WideEventSink, RecordErrorOptions };
export type { InstrumentationHooks } from "../shared/instrumentation/types.js";
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
  ProjectRulesDocument,
} from "../shared/project-rules.js";
export type {
  ProjectExtractionContext,
  ProjectExtractionMetadata,
  ProjectExtractionRequest,
  ProjectExtractionResponse,
} from "../shared/project-extraction.js";
