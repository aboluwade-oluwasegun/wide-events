import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { WideEvents } from "@wide-events/sdk";

export interface LambdaExampleOptions {
  collectorUrl?: string;
  environment?: string;
  serviceName?: string;
}

function resolveOptions(
  options: LambdaExampleOptions,
): Required<LambdaExampleOptions> {
  return {
    collectorUrl:
      options.collectorUrl ??
      process.env["WIDE_EVENTS_COLLECTOR_URL"] ??
      "http://localhost:4318",
    environment:
      options.environment ??
      process.env["WIDE_EVENTS_ENVIRONMENT"] ??
      "development",
    serviceName:
      options.serviceName ??
      process.env["WIDE_EVENTS_SERVICE_NAME"] ??
      "example-lambda",
  };
}

export function createLambdaExample(options: LambdaExampleOptions = {}): {
  handler: (
    event: APIGatewayProxyEventV2,
    context: Context,
  ) => Promise<APIGatewayProxyStructuredResultV2>;
  wideEvents: WideEvents;
} {
  const resolved = resolveOptions(options);
  const wideEvents = new WideEvents({
    serviceName: resolved.serviceName,
    environment: resolved.environment,
    collectorUrl: resolved.collectorUrl,
  });

  const handler = wideEvents.wrapHandler<
    APIGatewayProxyEventV2,
    Context,
    APIGatewayProxyStructuredResultV2
  >((event) => {
    wideEvents.annotate({
      "http.request.method": event.requestContext.http.method,
      "http.route": event.rawPath || "/lambda",
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
      headers: {
        "content-type": "application/json",
      },
    };
  });

  return {
    handler,
    wideEvents,
  };
}

let defaultExample: ReturnType<typeof createLambdaExample> | null = null;

export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyStructuredResultV2> {
  defaultExample ??= createLambdaExample();
  return await defaultExample.handler(event, context);
}
