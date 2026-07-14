import { EventEmitter } from "node:events";
import type { WideEvent } from "@wide-events/internal";
import { describe, expect, it, vi } from "vitest";
import {
  WideEvents,
  type ExpressRequestLike,
  type ExpressResponseLike,
  type NestExecutionContextLike,
  type NestHttpArgumentsHostLike,
  type NestObservableLike,
  type NestObserverLike,
} from "./index";

interface FakeNestObserver<TResult> {
  next(value: TResult): void;
  error(error: unknown): void;
  complete(): void;
}

class FakeNestResponse extends EventEmitter implements ExpressResponseLike {
  statusCode = 200;
  sentBody: unknown;

  json(body: unknown): this {
    this.sentBody = body;
    this.emit("finish");
    return this;
  }

  send(body?: unknown): this {
    this.sentBody = body;
    this.emit("finish");
    return this;
  }

  override once(event: "finish", listener: () => void): this {
    return super.once(event, listener);
  }
}

class FakeNestExecutionContext implements NestExecutionContextLike {
  constructor(
    private readonly request: ExpressRequestLike,
    private readonly response: FakeNestResponse,
  ) {}

  switchToHttp(): NestHttpArgumentsHostLike {
    return {
      getRequest: <TRequest extends ExpressRequestLike = ExpressRequestLike>() =>
        this.request as TRequest,
      getResponse: <TResponse extends ExpressResponseLike = ExpressResponseLike>() =>
        this.response as unknown as TResponse,
    };
  }
}

class FakeNestObservable<TResult> implements NestObservableLike<TResult> {
  constructor(private readonly produce: (observer: FakeNestObserver<TResult>) => void) {}

  subscribe(
    observerOrNext?: NestObserverLike<TResult> | ((value: TResult) => void),
    error?: (error: unknown) => void,
    complete?: () => void,
  ): void {
    const observer = normalizeObserver(observerOrNext, error, complete);
    this.produce(observer);
  }
}

describe("WideEvents Nest adapter", () => {
  it("emits project metadata from the Nest middleware helper", async () => {
    const exportedEvents: WideEvent[] = [];
    const wide = createNestWideEvents(exportedEvents, {
      version: 1,
      rules: [
        {
          project_id: "project_checkout",
          project_rule_version: "rules-v1",
          match: {
            method: "POST",
            path: "/checkout",
          },
          fields: [
            {
              field: "cart.item_count",
              source: "request.body",
              path: "cart.itemCount",
              type: "BIGINT",
            },
          ],
        },
      ],
    });
    await wide.getProjectRules();
    const response = new FakeNestResponse();

    await invokeNestMiddleware(
      wide,
      {
        method: "POST",
        url: "/checkout",
        path: "/checkout",
        body: {
          cart: {
            itemCount: 2,
          },
        },
      },
      response,
      () => {
        response.send("ok");
      },
    );

    await waitFor(() => exportedEvents.length === 1);
    expect(exportedEvents[0]).toEqual(
      expect.objectContaining({
        project_id: "project_checkout",
        project_rule_version: "rules-v1",
        project_fields: {
          "cart.item_count": 2,
        },
        project_field_types: {
          "cart.item_count": "BIGINT",
        },
      }),
    );
  });

  it("extracts project fields from Nest interceptor response values", async () => {
    const exportedEvents: WideEvent[] = [];
    const wide = createNestWideEvents(exportedEvents, {
      version: 1,
      rules: [
        {
          project_id: "project_checkout",
          project_rule_version: "rules-v2",
          match: {
            method: "POST",
            path: "/checkout",
          },
          fields: [
            {
              field: "order.total",
              source: "response.body",
              path: "total",
              type: "DOUBLE",
            },
            {
              field: "response.status",
              source: "response.status",
              type: "BIGINT",
            },
          ],
        },
      ],
    });
    await wide.getProjectRules();
    const response = new FakeNestResponse();
    response.statusCode = 201;
    const context = new FakeNestExecutionContext(
      {
        method: "POST",
        originalUrl: "/checkout?coupon=SUMMER",
        path: "/checkout",
      },
      response,
    );

    const observable = await wide.nestInterceptor<{ total: number }>().intercept(context, {
      handle: () =>
        new FakeNestObservable((observer) => {
          wide.annotate({ "user.id": "user_123" });
          observer.next({ total: 42.5 });
          observer.complete();
        }),
    });
    const values = await collectObservable(observable);

    expect(values).toEqual([{ total: 42.5 }]);
    await waitFor(() => exportedEvents.length === 1);
    expect(exportedEvents[0]).toEqual(
      expect.objectContaining({
        "http.status_code": 201,
        "user.id": "user_123",
        project_fields: {
          "order.total": 42.5,
          "response.status": 201,
        },
        project_field_types: {
          "order.total": "DOUBLE",
          "response.status": "BIGINT",
        },
      }),
    );
  });

  it("leaves unmatched Nest interceptor requests as normal events", async () => {
    const exportedEvents: WideEvent[] = [];
    const wide = createNestWideEvents(exportedEvents, {
      version: 1,
      rules: [
        {
          project_id: "project_checkout",
          project_rule_version: "rules-v3",
          match: {
            method: "POST",
            path: "/checkout",
          },
          fields: [
            {
              field: "order.total",
              source: "response.body",
              path: "total",
              type: "DOUBLE",
            },
          ],
        },
      ],
    });
    await wide.getProjectRules();
    const response = new FakeNestResponse();
    const context = new FakeNestExecutionContext(
      {
        method: "GET",
        originalUrl: "/health?full=true",
        path: "/health",
      },
      response,
    );

    const observable = await wide.nestInterceptor<{ ok: boolean }>().intercept(context, {
      handle: () =>
        new FakeNestObservable((observer) => {
          observer.next({ ok: true });
          observer.complete();
        }),
    });
    const values = await collectObservable(observable);

    expect(values).toEqual([{ ok: true }]);
    await waitFor(() => exportedEvents.length === 1);
    expect(exportedEvents[0]).toEqual(
      expect.objectContaining({
        "http.route": "/health",
        "http.status_code": 200,
      }),
    );
    expect(exportedEvents[0]?.project_id).toBeUndefined();
    expect(exportedEvents[0]?.project_fields).toBeUndefined();
    expect(exportedEvents[0]?.project_field_types).toBeUndefined();
  });
});

function createNestWideEvents(
  exportedEvents: WideEvent[],
  rulesDocument: unknown,
): WideEvents {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(createProjectDiscoveryResponse(rulesDocument)), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

  return new WideEvents({
    serviceName: "checkout-api",
    environment: "prod",
    apiKey: "we_key_123",
    apiUrl: "https://api.example.com",
    projects: {
      ids: ["project_checkout"],
      refreshIntervalMs: 30_000,
    },
    fetchImpl,
    sink: {
      write(events) {
        exportedEvents.push(...events);
      },
    },
  });
}

function createProjectDiscoveryResponse(rulesDocument: unknown): unknown {
  const routesByProject = new Map<
    string,
    {
      rule_version: string;
      routes: Array<{ match: unknown; fields: unknown }>;
    }
  >();
  const rules = isRecord(rulesDocument) && Array.isArray(rulesDocument["rules"])
    ? rulesDocument["rules"]
    : [];

  for (const rule of rules) {
    if (!isRecord(rule)) {
      continue;
    }

    const projectId = String(rule["project_id"] ?? "");
    const ruleVersion = String(rule["project_rule_version"] ?? "");
    if (!projectId || !ruleVersion) {
      continue;
    }

    const project = routesByProject.get(projectId) ?? {
      rule_version: ruleVersion,
      routes: [],
    };
    project.routes.push({
      match: rule["match"],
      fields: rule["fields"],
    });
    routesByProject.set(projectId, project);
  }

  return {
    rulesUrl: "https://cdn.example.com/wide-events/rules.json",
    projects: [...routesByProject.entries()].map(([project_id, project]) => ({
      project_id,
      rule_version: project.rule_version,
      rules: {
        routes: project.routes,
      },
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function invokeNestMiddleware(
  wide: WideEvents,
  request: ExpressRequestLike,
  response: FakeNestResponse,
  handler: () => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    wide.nestMiddleware()(request, response, (error?: unknown) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      handler();
      resolve();
    });
  });
}

async function collectObservable<TResult>(
  observable: NestObservableLike<TResult>,
): Promise<TResult[]> {
  return await new Promise<TResult[]>((resolve, reject) => {
    const values: TResult[] = [];
    observable.subscribe({
      next(value) {
        values.push(value);
      },
      error(cause) {
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      },
      complete() {
        resolve(values);
      },
    });
  });
}

function normalizeObserver<TResult>(
  observerOrNext?: NestObserverLike<TResult> | ((value: TResult) => void),
  error?: (error: unknown) => void,
  complete?: () => void,
): FakeNestObserver<TResult> {
  if (typeof observerOrNext === "function") {
    return {
      next: observerOrNext,
      error: error ?? noopError,
      complete: complete ?? noop,
    };
  }

  return {
    next: observerOrNext?.next ?? noop,
    error: observerOrNext?.error ?? error ?? noopError,
    complete: observerOrNext?.complete ?? complete ?? noop,
  };
}

function noop(): void {}

function noopError(_error: unknown): void {}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for Nest adapter assertion");
}
