import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";
import type Redis from "ioredis";

import type { InstrumentationHooks } from "../../shared/instrumentation/types.js";
import { instrumentIoredis } from "./ioredis.js";

describe("instrumentIoredis", () => {
  it("records redis.commands on reply", () => {
    const pushSpy = vi.fn();
    const recordErrorSpy = vi.fn();
    const hooks: InstrumentationHooks = {
      push: pushSpy,
      recordError: recordErrorSpy,
    };

    const client = new EventEmitter() as Redis;
    instrumentIoredis(client, hooks);

    client.emit("command", {
      commandId: "cid-1",
      name: "get",
      args: ["session:abc"],
    });
    client.emit("reply", {
      commandId: "cid-1",
      name: "get",
      args: ["session:abc"],
    });

    expect(pushSpy).toHaveBeenCalledWith(
      "redis.commands",
      expect.objectContaining({
        command: "GET",
        key: "session:abc",
      }),
    );
    expect(recordErrorSpy).not.toHaveBeenCalled();
  });

  it("records redis.errors on error-reply", () => {
    const pushSpy = vi.fn();
    const recordErrorSpy = vi.fn();
    const hooks: InstrumentationHooks = {
      push: pushSpy,
      recordError: recordErrorSpy,
    };

    const client = new EventEmitter() as Redis;
    instrumentIoredis(client, hooks);

    client.emit("command", {
      commandId: "cid-2",
      name: "get",
      args: ["k"],
    });
    client.emit(
      "error-reply",
      {
        commandId: "cid-2",
        name: "get",
        args: ["k"],
      },
      new Error("WRONGTYPE"),
    );

    expect(pushSpy).toHaveBeenCalledWith(
      "redis.errors",
      expect.objectContaining({
        command: "GET",
        key: "k",
        error: "WRONGTYPE",
      }),
    );
    expect(recordErrorSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ slug: "redis_error_reply" }),
    );
  });

  it("does not register listeners twice for the same client", () => {
    const hooks: InstrumentationHooks = {
      push: vi.fn(),
      recordError: vi.fn(),
    };

    const client = new EventEmitter() as Redis;
    const spy = vi.spyOn(client, "on");

    instrumentIoredis(client, hooks);
    instrumentIoredis(client, hooks);

    const commandListeners = spy.mock.calls.filter((c) => c[0] === "command").length;
    expect(commandListeners).toBe(1);

    spy.mockRestore();
  });
});
