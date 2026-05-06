/**
 * Optional Redis example — wired only when `REDIS_URL` is set.
 */
import Redis from "ioredis";
import type { InstrumentationHooks } from "@wide-events/sdk";
import { instrumentIoredis } from "@wide-events/sdk/instrumentation/ioredis";

export interface RedisHealthExampleOptions {
  url?: string;
}

/** Returns a client wrapper or `undefined` when skipped. */
export function createRedisHealthExample(
  hooks: InstrumentationHooks,
  options: RedisHealthExampleOptions = {},
): RedisExampleResult | undefined {
  const url = options.url ?? process.env["REDIS_URL"] ?? "";

  if (url === "") {
    return undefined;
  }

  const client = new Redis(url);
  instrumentIoredis(client, hooks);

  return {
    client,
    async ping(): Promise<string> {
      return await client.ping();
    },

    async quit(): Promise<void> {
      await client.quit().catch(() => undefined);
    },
  };
}

interface RedisExampleResult {
  client: Redis;
  ping(): Promise<string>;
  quit(): Promise<void>;
}
