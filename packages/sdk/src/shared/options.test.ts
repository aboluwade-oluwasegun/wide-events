import { describe, expect, it } from "vitest";
import { resolveNodeOptions } from "./options";

describe("resolveNodeOptions", () => {
  it("defaults to lightweight fetch instrumentation being disabled", () => {
    const options = resolveNodeOptions({
      serviceName: "payments",
      collectorUrl: "http://collector.test",
    });

    expect(options.autoInstrument.fetch).toBe(false);
  });

  it("lets fetch instrumentation be enabled explicitly", () => {
    const options = resolveNodeOptions({
      serviceName: "payments",
      collectorUrl: "http://collector.test",
      autoInstrument: {
        fetch: true,
      },
    });

    expect(options.autoInstrument.fetch).toBe(true);
  });
});
