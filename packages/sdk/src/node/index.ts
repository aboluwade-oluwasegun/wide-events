import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WideEvent } from "@wide-events/internal";
import {
  CoreWideEvents,
  type ContextStorage,
  type RecordErrorOptions,
  type WideEventContext,
  type WideEventSink,
} from "../shared/core";
import {
  resolveNodeOptions,
  type ResolvedWideEventsOptions,
  type WideEventsOptions,
} from "../shared/options";

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

class AsyncContextStorage implements ContextStorage {
  private readonly storage = new AsyncLocalStorage<WideEventContext>();

  getStore(): WideEventContext | undefined {
    return this.storage.getStore();
  }

  run<T>(context: WideEventContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }
}

export class WideEvents {
  readonly options: ResolvedWideEventsOptions;
  private readonly storage = new AsyncContextStorage();
  private readonly core: CoreWideEvents;

  constructor(options: WideEventsOptions) {
    this.options = resolveNodeOptions(options);
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
  push: CoreWideEvents["push"] = (...args) => this.core.push(...args);
  recordError: CoreWideEvents["recordError"] = (...args) => this.core.recordError(...args);
  wrapFetch: CoreWideEvents["wrapFetch"] = (...args) => this.core.wrapFetch(...args);
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

export function createWideEvents(options: WideEventsOptions): WideEvents {
  return new WideEvents(options);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type { WideEventsOptions, WideEventSink, RecordErrorOptions };
