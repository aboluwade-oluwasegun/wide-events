import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  APIGatewayEventRequestContextV2,
  APIGatewayProxyEventV2WithRequestContext,
  Context,
} from "aws-lambda";
import type { ExecutionContext } from "@cloudflare/workers-types";
import { afterEach, describe, expect, it } from "vitest";
import { createLambdaExample } from "../examples/lambda/src/handler";
import {
  startNodeServiceExample,
  type StartedNodeServiceExample,
} from "../examples/node-service/src/server";
import { handleWorkerRequest } from "../examples/worker/src/worker";
import { WideEventsClient } from "../packages/client/src/index";
import type { CollectorConfig } from "../packages/collector/src/config";
import { createCollectorServer } from "../packages/collector/src/server";

describe("wide-events live HTTP", () => {
  let workspaceDir = "";

  afterEach(async () => {
    if (workspaceDir) {
      await rm(workspaceDir, { recursive: true, force: true });
      workspaceDir = "";
    }
  });

  it("ingests node, lambda, and worker telemetry over HTTP and serves queries through the client", async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), "wide-events-e2e-"));
    const collectorPort = await getAvailablePort();
    const collector = await createCollectorServer(
      createTestCollectorConfig({
        duckDbPath: join(workspaceDir, "events.duckdb"),
        port: collectorPort,
        batchSize: 1,
        batchTimeoutMs: 10,
      }),
    );
    const collectorUrl = `http://127.0.0.1:${collectorPort}`;
    const client = new WideEventsClient({ url: collectorUrl });

    let nodeExample: StartedNodeServiceExample | null = null;

    try {
      await collector.start();

      const nodePort = await getAvailablePort();
      nodeExample = await startNodeServiceExample({
        collectorUrl,
        host: "127.0.0.1",
        port: nodePort,
        serviceName: "node-example-e2e",
      });

      const nodeResponse = await fetch(`http://127.0.0.1:${nodePort}/checkout`);
      expect(nodeResponse.status).toBe(200);
      await nodeExample.wideEvents.forceFlush();

      const nodeCount = await waitFor(async () => {
        const result = await client.query({
          select: [{ fn: "COUNT", as: "total" }],
          filters: [
            { field: "service.name", op: "eq", value: "node-example-e2e" },
          ],
        });
        expect(result.rows[0]?.["total"]).toBe(1);
        return result.rows[0]?.["total"];
      });
      expect(nodeCount).toBe(1);

      const latencyByRoute = await client.query({
        select: [{ fn: "P95", field: "duration_ms", as: "p95_ms" }],
        filters: [
          { field: "service.name", op: "eq", value: "node-example-e2e" },
        ],
        groupBy: ["http.route"],
      });
      expect(latencyByRoute.rows[0]?.["http.route"]).toBe("/checkout");
      expect(typeof latencyByRoute.rows[0]?.["p95_ms"]).toBe("number");

      await nodeExample.close();
      nodeExample = null;

      const { handler: lambdaHandler, wideEvents: lambdaWideEvents } =
        createLambdaExample({
          collectorUrl,
          serviceName: "lambda-example-e2e",
        });
      try {
        const lambdaResponse = await lambdaHandler(
          createEvent(),
          createContext(),
        );
        expect(lambdaResponse.statusCode).toBe(200);
      } finally {
        await lambdaWideEvents.shutdown();
      }

      const lambdaCount = await waitFor(async () => {
        const result = await client.query({
          select: [{ fn: "COUNT", as: "total" }],
          filters: [
            { field: "service.name", op: "eq", value: "lambda-example-e2e" },
          ],
        });
        expect(result.rows[0]?.["total"]).toBe(1);
        return result.rows[0]?.["total"];
      });
      expect(lambdaCount).toBe(1);

      const executionContext = createExecutionContext();
      const workerResponse = await handleWorkerRequest(
        new Request("http://example.test/worker", { method: "POST" }),
        {
          WIDE_EVENTS_COLLECTOR_URL: collectorUrl,
          WIDE_EVENTS_ENVIRONMENT: "test",
          WIDE_EVENTS_SERVICE_NAME: "worker-example-e2e",
        },
        executionContext,
      );
      expect(workerResponse.status).toBe(200);
      await Promise.all(executionContext.promises);

      const workerCount = await waitFor(async () => {
        const result = await client.query({
          select: [{ fn: "COUNT", as: "total" }],
          filters: [
            { field: "service.name", op: "eq", value: "worker-example-e2e" },
          ],
        });
        expect(result.rows[0]?.["total"]).toBe(1);
        return result.rows[0]?.["total"];
      });
      expect(workerCount).toBe(1);

      const columns = await client.getColumns();
      expect(columns.some((column) => column.name === "http.route")).toBe(true);
    } finally {
      if (nodeExample) {
        await nodeExample.close();
      }
      await collector.close();
    }
  });
});

function createExecutionContext(): ExecutionContext & {
  promises: Promise<unknown>[];
} {
  const promises: Promise<unknown>[] = [];

  return {
    promises,
    props: {},
    passThroughOnException() {},
    waitUntil(promise: Promise<unknown>) {
      promises.push(promise);
    },
  };
}

async function getAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() =>
          reject(new Error("Failed to determine an ephemeral port")),
        );
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function waitFor<T>(
  assertion: () => Promise<T>,
  attempts = 30,
): Promise<T> {
  let lastError: unknown;

  for (let index = 0; index < attempts; index += 1) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function createEvent(): APIGatewayProxyEventV2WithRequestContext<APIGatewayEventRequestContextV2> {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/lambda",
    rawQueryString: "",
    headers: {},
      requestContext: {
        accountId: "account",
        apiId: "api-id",
        domainName: "example.execute-api.us-east-1.amazonaws.com",
        domainPrefix: "example",
      http: {
        method: "GET",
        path: "/lambda",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
        requestId: "request-id",
        routeKey: "$default",
        stage: "$default",
        time: "01/Jan/2024:00:00:00 +0000",
        timeEpoch: 1,
      },
    isBase64Encoded: false,
  };
}

function createTestCollectorConfig(
  overrides: Partial<CollectorConfig>,
): CollectorConfig {
  return {
    duckDbPath: "unused",
    port: 4318,
    batchSize: 100,
    batchTimeoutMs: 1_000,
    retentionDays: 30,
    maxPromotedColumns: 200,
    promotionIntervalMs: 300_000,
    promotionMinRows: 1_000,
    promotionMinRatio: 0.01,
    promotionMaxKeysPerRun: 1,
    queueLimit: 10_000,
    ...overrides,
  };
}

function createContext(): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: "example-handler",
    functionVersion: "$LATEST",
    invokedFunctionArn:
      "arn:aws:lambda:us-east-1:123456789012:function:example-handler",
    memoryLimitInMB: "128",
    awsRequestId: "aws-request-id",
    logGroupName: "/aws/lambda/example-handler",
    logStreamName: "2024/01/01/[$LATEST]abcdef",
    getRemainingTimeInMillis() {
      return 10_000;
    },
    done() {},
    fail() {},
    succeed() {},
  };
}
