import type { InstrumentationHooks } from "../../shared/instrumentation/types.js";

/** Unique Smithy middleware id so repeats are detectable when debugging. */
export const AWS_SDK_V3_INSTRUMENTATION_MIDDLEWARE_NAME = "@wide-events/instrument-aws-sdk-v3";

const instrumentedClients = new WeakSet<object>();

type AwsMiddlewareHandlerArgs = {
  input?: unknown;
};

type AwsMiddlewareHandlerResult = {
  output?: unknown;
};

type AwsMiddlewareHandler = (args: AwsMiddlewareHandlerArgs) => Promise<AwsMiddlewareHandlerResult>;

type AwsMiddleware = (
  next: AwsMiddlewareHandler,
  context: { commandName?: string },
) => AwsMiddlewareHandler;

/** Minimal middleware stack carrier (no runtime dependency on `@smithy/types`). */
export interface AwsSdkV3ClientTarget {
  config?: {
    serviceId?: string;
  };
  middlewareStack: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- preserve compatibility with concrete AWS SDK v3 overload signatures
    add: (middleware: any, options?: any) => void;
  };
}

function readTableName(input: unknown): string | null {
  if (input === null || typeof input !== "object") {
    return null;
  }
  const rec = input as Record<string, unknown>;
  const direct = rec["TableName"];
  return typeof direct === "string" ? direct : null;
}

function readCapacity(output: unknown): number | null {
  if (output === null || typeof output !== "object") {
    return null;
  }
  const consumed = (output as { ConsumedCapacity?: { CapacityUnits?: number } }).ConsumedCapacity?.CapacityUnits;
  return typeof consumed === "number" ? consumed : null;
}

function getOperationName(handlerContext: { commandName?: string }): string | null {
  return typeof handlerContext.commandName === "string" ? handlerContext.commandName : null;
}

function readInput(input: AwsMiddlewareHandlerArgs): unknown {
  return typeof input.input === "undefined" ? input : input.input;
}

function readOutput(result: AwsMiddlewareHandlerResult): unknown {
  return typeof result.output === "undefined" ? result : result.output;
}

function buildMiddleware(hooks: InstrumentationHooks, serviceId: string | null): AwsMiddleware {
  return (next: AwsMiddlewareHandler, handlerContext: { commandName?: string }) =>
    async (args: AwsMiddlewareHandlerArgs): Promise<AwsMiddlewareHandlerResult> => {
      const startedAt = performance.now();
      const commandName = getOperationName(handlerContext);
      const inputForExtras = readInput(args);

      try {
        const result = await next(args);
        const output = readOutput(result);

        hooks.push("aws.client.operations", {
          operation: commandName,
          service_id: serviceId,
          duration_ms: performance.now() - startedAt,
          table: readTableName(inputForExtras),
          capacity_units: readCapacity(output),
        });
        return result;
      } catch (error: unknown) {
        hooks.push("aws.client.errors", {
          operation: commandName,
          service_id: serviceId,
          duration_ms: performance.now() - startedAt,
          table: readTableName(inputForExtras),
          error: error instanceof Error ? error.message : String(error),
        });
        hooks.recordError(error, { slug: "aws_sdk_v3_operation_failed", handled: false });
        throw error;
      }
    };
}

export interface InstrumentAwsSdkV3Options {
  /** Middleware registration name override (advanced). */
  middlewareName?: string;
}

/**
 * Add wide-event middleware to any AWS SDK for JavaScript v3 client.
 *
 * Subsequent calls with the **same client** no-op — install once per client.
 *
 * Instrument the base client **before** wrapping with `DynamoDBDocumentClient.from(...)`.
 */
export function instrumentAwsSdkV3(
  client: AwsSdkV3ClientTarget,
  hooks: InstrumentationHooks,
  options: InstrumentAwsSdkV3Options = {},
): void {
  if (instrumentedClients.has(client)) {
    return;
  }
  instrumentedClients.add(client);

  const serviceId = typeof client.config?.serviceId === "string" ? client.config.serviceId : null;
  const middleware = buildMiddleware(hooks, serviceId);
  const name = options.middlewareName ?? AWS_SDK_V3_INSTRUMENTATION_MIDDLEWARE_NAME;

  client.middlewareStack.add(middleware, {
    step: "initialize",
    name,
    tags: ["WIDE_EVENTS"],
  });
}
