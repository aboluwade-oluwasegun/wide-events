import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { WideEvents } from "@wide-events/sdk";

export interface NodeServiceExampleOptions {
  collectorUrl?: string;
  environment?: string;
  host?: string;
  port?: number;
  serviceName?: string;
}

export interface StartedNodeServiceExample {
  close(): Promise<void>;
  server: Server;
  wideEvents: WideEvents;
}

function resolveOptions(options: NodeServiceExampleOptions): Required<NodeServiceExampleOptions> {
  return {
    collectorUrl:
      options.collectorUrl ??
      process.env["WIDE_EVENTS_COLLECTOR_URL"] ??
      "http://localhost:4318",
    environment:
      options.environment ??
      process.env["WIDE_EVENTS_ENVIRONMENT"] ??
      "development",
    host: options.host ?? "0.0.0.0",
    port: options.port ?? 3000,
    serviceName:
      options.serviceName ??
      process.env["WIDE_EVENTS_SERVICE_NAME"] ??
      "node-service"
  };
}

export function createNodeServiceExample(
  options: NodeServiceExampleOptions = {}
): { server: Server; wideEvents: WideEvents } {
  const resolved = resolveOptions(options);
  const wideEvents = new WideEvents({
    serviceName: resolved.serviceName,
    environment: resolved.environment,
    collectorUrl: resolved.collectorUrl
  });
  const middleware = wideEvents.middleware();
  const server = createServer((request, response) => {
    middleware(
      {
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([key, value]) => [
            key,
            Array.isArray(value) ? value : value ?? undefined
          ])
        )
      },
      response,
      () => {
        wideEvents.annotate({
          "http.route": request.url ?? "/"
        });

        response.statusCode = 200;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true }));
      }
    );
  });

  return {
    server,
    wideEvents
  };
}

export async function startNodeServiceExample(
  options: NodeServiceExampleOptions = {}
): Promise<StartedNodeServiceExample> {
  const resolved = resolveOptions(options);
  const { server, wideEvents } = createNodeServiceExample(resolved);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(resolved.port, resolved.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    server,
    wideEvents,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      await wideEvents.shutdown();
    }
  };
}

async function main(): Promise<void> {
  await startNodeServiceExample();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error("Failed to start node example", error);
    process.exitCode = 1;
  });
}
