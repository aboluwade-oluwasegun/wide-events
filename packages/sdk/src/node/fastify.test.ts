import type { WideEvent } from "@wide-events/internal";
import { describe, expect, it, vi } from "vitest";
import {
  WideEvents,
  type FastifyDone,
  type FastifyInstanceLike,
  type FastifyPayloadDone,
  type FastifyReplyLike,
  type FastifyRequestLike,
} from "./index";

type LifecycleHook = (
  request: FastifyRequestLike,
  reply: FastifyReplyLike,
) => Promise<void> | void;
type PreHandlerHook = (
  request: FastifyRequestLike,
  reply: FastifyReplyLike,
  done: FastifyDone,
) => void;
type PayloadHook = (
  request: FastifyRequestLike,
  reply: FastifyReplyLike,
  payload: unknown,
  done: FastifyPayloadDone,
) => void;

class FakeFastifyReply implements FastifyReplyLike {
  statusCode = 200;
  raw = { statusCode: 200 };

  code(statusCode: number): this {
    this.statusCode = statusCode;
    this.raw.statusCode = statusCode;
    return this;
  }
}

class FakeFastify implements FastifyInstanceLike {
  private readonly onRequestHooks: LifecycleHook[] = [];
  private readonly preHandlerHooks: PreHandlerHook[] = [];
  private readonly preSerializationHooks: PayloadHook[] = [];
  private readonly onSendHooks: PayloadHook[] = [];
  private readonly onResponseHooks: LifecycleHook[] = [];

  addHook(name: "onRequest" | "onResponse", hook: LifecycleHook): unknown;
  addHook(name: "preHandler", hook: PreHandlerHook): unknown;
  addHook(name: "preSerialization" | "onSend", hook: PayloadHook): unknown;
  addHook(
    name: "onRequest" | "onResponse" | "preHandler" | "preSerialization" | "onSend",
    hook: LifecycleHook | PreHandlerHook | PayloadHook,
  ): unknown {
    switch (name) {
      case "onRequest":
        this.onRequestHooks.push(hook as LifecycleHook);
        return undefined;
      case "preHandler":
        this.preHandlerHooks.push(hook as PreHandlerHook);
        return undefined;
      case "preSerialization":
        this.preSerializationHooks.push(hook as PayloadHook);
        return undefined;
      case "onSend":
        this.onSendHooks.push(hook as PayloadHook);
        return undefined;
      case "onResponse":
        this.onResponseHooks.push(hook as LifecycleHook);
        return undefined;
      default:
        return assertNever(name);
    }
  }

  async inject({
    request,
    reply = new FakeFastifyReply(),
    handler,
  }: {
    request: FastifyRequestLike;
    reply?: FakeFastifyReply | undefined;
    handler: () => Promise<unknown> | unknown;
  }): Promise<unknown> {
    for (const hook of this.onRequestHooks) {
      await hook(request, reply);
    }

    for (const hook of this.preHandlerHooks) {
      await runDoneHook(hook, request, reply);
    }

    let payload = await handler();
    for (const hook of this.preSerializationHooks) {
      payload = await runPayloadHook(hook, request, reply, payload);
    }

    let sentPayload: unknown =
      typeof payload === "string" ? payload : JSON.stringify(payload);
    for (const hook of this.onSendHooks) {
      sentPayload = await runPayloadHook(hook, request, reply, sentPayload);
    }

    for (const hook of this.onResponseHooks) {
      await hook(request, reply);
    }

    return sentPayload;
  }
}

describe("WideEvents Fastify adapter", () => {
  it("emits project metadata from matching request rules", async () => {
    const exportedEvents: WideEvent[] = [];
    const wide = createFastifyWideEvents(exportedEvents, {
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
    const fastify = installFastifyPlugin(wide);

    await fastify.inject({
      request: {
        method: "POST",
        url: "/checkout?coupon=SUMMER",
        routeOptions: { url: "/checkout" },
        body: {
          cart: {
            itemCount: 2,
          },
        },
      },
      handler: () => {
        wide.annotate({ "user.id": "user_123" });
        return "ok";
      },
    });

    await waitFor(() => exportedEvents.length === 1);
    expect(exportedEvents[0]).toEqual(
      expect.objectContaining({
        "http.route": "/checkout",
        project_id: "project_checkout",
        project_rule_version: "rules-v1",
        project_fields: {
          "cart.item_count": 2,
        },
        project_field_types: {
          "cart.item_count": "BIGINT",
        },
        "user.id": "user_123",
      }),
    );
  });

  it("extracts project fields from Fastify response bodies", async () => {
    const exportedEvents: WideEvent[] = [];
    const wide = createFastifyWideEvents(exportedEvents, {
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
    const fastify = installFastifyPlugin(wide);
    const reply = new FakeFastifyReply().code(201);

    await fastify.inject({
      request: {
        method: "POST",
        url: "/checkout",
        routeOptions: { url: "/checkout" },
      },
      reply,
      handler: () => ({ total: 42.5 }),
    });

    await waitFor(() => exportedEvents.length === 1);
    expect(exportedEvents[0]).toEqual(
      expect.objectContaining({
        "http.status_code": 201,
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

  it("leaves unmatched Fastify requests as normal events", async () => {
    const exportedEvents: WideEvent[] = [];
    const wide = createFastifyWideEvents(exportedEvents, {
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
    const fastify = installFastifyPlugin(wide);

    await fastify.inject({
      request: {
        method: "GET",
        url: "/health?full=true",
        routeOptions: { url: "/health" },
      },
      handler: () => "ok",
    });

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

function createFastifyWideEvents(
  exportedEvents: WideEvent[],
  rulesDocument: unknown,
): WideEvents {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(rulesDocument), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

  return new WideEvents({
    serviceName: "checkout-api",
    environment: "prod",
    projects: ["project_checkout"],
    projectRules: {
      url: "https://cdn.example.com/wide-events/project-rules.json",
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

function installFastifyPlugin(wide: WideEvents): FakeFastify {
  const fastify = new FakeFastify();
  let installError: Error | undefined;

  wide.fastifyPlugin()(fastify, undefined, (error) => {
    installError = error;
  });

  if (installError) {
    throw installError;
  }

  return fastify;
}

async function runDoneHook(
  hook: PreHandlerHook,
  request: FastifyRequestLike,
  reply: FastifyReplyLike,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    hook(request, reply, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function runPayloadHook(
  hook: PayloadHook,
  request: FastifyRequestLike,
  reply: FastifyReplyLike,
  payload: unknown,
): Promise<unknown> {
  return await new Promise<unknown>((resolve, reject) => {
    hook(request, reply, payload, (error, nextPayload) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(nextPayload);
    });
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for Fastify adapter assertion");
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Fastify hook: ${String(value)}`);
}
