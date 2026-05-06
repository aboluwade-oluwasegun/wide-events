import type { Cluster, Redis } from "ioredis";
import type { InstrumentationHooks } from "../../shared/instrumentation/types.js";

interface CommandLike {
  commandId?: string;
  name: string;
  args?: unknown[];
}

export type IoredisClientTarget = Redis | Cluster;

const patchedClients = new WeakSet<IoredisClientTarget>();

function formatRedisKeyArg(keyArg: unknown): string | null {
  if (typeof keyArg === "string") {
    return keyArg;
  }
  if (typeof keyArg === "number" || typeof keyArg === "boolean" || typeof keyArg === "bigint") {
    return String(keyArg);
  }
  return null;
}

function getCommandTiming(command: CommandLike, pendingStarts: Map<string, number>): number | null {
  if (typeof command.commandId !== "string") {
    return null;
  }
  const start = pendingStarts.get(command.commandId);
  pendingStarts.delete(command.commandId);
  return typeof start === "number" ? performance.now() - start : null;
}

function getCommandName(command: CommandLike): string | null {
  return typeof command.name === "string" ? command.name.toUpperCase() : null;
}

function getCommandKey(command: CommandLike): string | null {
  const keyArg = Array.isArray(command.args) ? command.args[0] : undefined;
  return formatRedisKeyArg(keyArg);
}

/**
 * Attach Redis command timings via `ioredis` event hooks.
 *
 * Emit `redis.commands` / `redis.errors` on reply and error paths.
 *
 * Install once per client — second call is a no-op.
 */
export function instrumentIoredis(
  client: IoredisClientTarget,
  hooks: InstrumentationHooks,
): void {
  if (patchedClients.has(client)) {
    return;
  }
  patchedClients.add(client);

  const pendingStarts = new Map<string, number>();

  client.on("command", (command: CommandLike) => {
    if (typeof command.commandId !== "string") return;
    pendingStarts.set(command.commandId, performance.now());
  });

  client.on("reply", (command: CommandLike) => {
    const durationMs = getCommandTiming(command, pendingStarts);
    if (durationMs === null) return;
    hooks.push("redis.commands", {
      command: getCommandName(command),
      key: getCommandKey(command),
      duration_ms: durationMs,
    });
  });

  client.on("error-reply", (command: CommandLike, error: Error) => {
    const durationMs = getCommandTiming(command, pendingStarts);

    hooks.push("redis.errors", {
      command: getCommandName(command),
      key: getCommandKey(command),
      duration_ms: durationMs,
      error: error.message,
    });
    hooks.recordError(error, { slug: "redis_error_reply", handled: false });
  });
}
