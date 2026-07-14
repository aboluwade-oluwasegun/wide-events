import type { WideEventContext } from "../shared/core.js";
import type { ProjectExtractionRule } from "../shared/project-rules.js";

export type NextFunction = (error?: unknown) => void;

export interface RequestLike {
  method?: string | undefined;
  url?: string | undefined;
  headers?: Record<string, string | string[] | undefined> | undefined;
}

export interface ResponseLike {
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

export interface FastifyRequestState {
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
