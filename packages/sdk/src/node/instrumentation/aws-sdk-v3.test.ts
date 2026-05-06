import { describe, expect, it, vi } from "vitest";

import type { InstrumentationHooks } from "../../shared/instrumentation/types.js";
import { AWS_SDK_V3_INSTRUMENTATION_MIDDLEWARE_NAME, instrumentAwsSdkV3 } from "./aws-sdk-v3.js";

interface CapturedMw {
  options: { name: string; step: string };
  run: (
    next: (args: unknown) => Promise<unknown>,
    context: { commandName: string },
    args: unknown,
  ) => Promise<unknown>;
}

function createTestClient() {
  const captured: CapturedMw[] = [];
  const client = {
    config: { serviceId: "DynamoDB" },
    middlewareStack: {
      add: (
        middleware: (next: (args: unknown) => Promise<unknown>, ctx: unknown) => (args: unknown) => unknown,
        options: { name: string; step: string },
      ) => {
        captured.push({
          options,
          run: async (next, handlerContext: { commandName: string }, args) => {
            const handler = middleware(
              next,
              handlerContext,
            ) as (a: unknown) => Promise<unknown>;
            return await handler(args);
          },
        });
      },
    },
  };
  return { client, captured };
}

describe("instrumentAwsSdkV3", () => {
  it("records successful operations with payload keys", async () => {
    const pushSpy = vi.fn();
    const recordErrorSpy = vi.fn();
    const hooks: InstrumentationHooks = {
      push: pushSpy,
      recordError: recordErrorSpy,
    };

    const { client, captured } = createTestClient();
    instrumentAwsSdkV3(client, hooks);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.options.name).toBe(AWS_SDK_V3_INSTRUMENTATION_MIDDLEWARE_NAME);
    expect(captured[0]?.options.step).toBe("initialize");

    const nextResult = Promise.resolve({
      output: { ConsumedCapacity: { CapacityUnits: 5 } },
    });

    await captured[0]!.run(
      () => nextResult,
      { commandName: "QueryCommand" },
      {
        input: { TableName: "orders", KeyConditionExpression: "x = :y" },
      },
    );

    expect(pushSpy).toHaveBeenCalledWith(
      "aws.client.operations",
      expect.objectContaining({
        operation: "QueryCommand",
        service_id: "DynamoDB",
        table: "orders",
        capacity_units: 5,
      }),
    );
    expect(recordErrorSpy).not.toHaveBeenCalled();
  });

  it("is idempotent for the same client", () => {
    const hooks: InstrumentationHooks = {
      push: vi.fn(),
      recordError: vi.fn(),
    };
    let addCalls = 0;
    const client = {
      config: {},
      middlewareStack: {
        add: (_mw: unknown, _opts: unknown) => {
          addCalls += 1;
        },
      },
    };

    instrumentAwsSdkV3(client, hooks);
    instrumentAwsSdkV3(client, hooks);
    expect(addCalls).toBe(1);
  });

  it("records errors and rethrows", async () => {
    const pushSpy = vi.fn();
    const recordErrorSpy = vi.fn();
    const hooks: InstrumentationHooks = {
      push: pushSpy,
      recordError: recordErrorSpy,
    };

    const { client, captured } = createTestClient();
    instrumentAwsSdkV3(client, hooks);

    await expect(
      captured[0]!.run(
        async () => {
          throw new Error("throttled");
        },
        { commandName: "GetItemCommand" },
        { input: { TableName: "items" } },
      ),
    ).rejects.toThrow("throttled");

    expect(pushSpy).toHaveBeenCalledWith(
      "aws.client.errors",
      expect.objectContaining({
        operation: "GetItemCommand",
        table: "items",
        error: "throttled",
      }),
    );
    expect(recordErrorSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ slug: "aws_sdk_v3_operation_failed" }),
    );
  });
});
