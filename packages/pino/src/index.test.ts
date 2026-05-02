import { describe, expect, it, vi } from "vitest";
import { pinoEventSink, pinoMixin } from "./index";

describe("@wide-events/pino", () => {
  it("adds active event correlation fields to pino mixins", () => {
    const mixin = pinoMixin({
      current() {
        return {
          event_id: "event-1",
          correlation_id: "corr-1",
          "service.name": "payments",
        };
      },
    });

    expect(mixin()).toEqual({
      event_id: "event-1",
      correlation_id: "corr-1",
      "service.name": "payments",
    });
  });

  it("writes completed wide events through pino", async () => {
    const info = vi.fn();
    const sink = pinoEventSink({ info } as never);

    await sink.write([
      {
        event_id: "event-1",
        correlation_id: "corr-1",
        name: "request",
        attributes: { "order.total": 42 },
      },
    ]);

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        wide_event: true,
        event_id: "event-1",
        correlation_id: "corr-1",
        "order.total": 42,
      }),
      "request",
    );
  });
});
