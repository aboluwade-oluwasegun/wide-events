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

  it("defaults project routing to disabled", () => {
    const options = resolveNodeOptions({
      serviceName: "payments",
      collectorUrl: "http://collector.test",
    });

    expect(options.projects).toBe(false);
  });

  it("accepts collector-driven project routing", () => {
    const options = resolveNodeOptions({
      serviceName: "payments",
      collectorUrl: "http://collector.test",
      projects: true,
    });

    expect(options.projects).toBe(true);
  });

  it("accepts explicit project ids", () => {
    const options = resolveNodeOptions({
      serviceName: "payments",
      collectorUrl: "http://collector.test",
      projects: ["project_a", "project_b"],
    });

    expect(options.projects).toEqual(["project_a", "project_b"]);
  });

  it("accepts project rule cache config", () => {
    const options = resolveNodeOptions({
      serviceName: "payments",
      collectorUrl: "http://collector.test",
      projectRules: {
        url: "https://cdn.example.com/wide-events/project-rules.json",
      },
    });

    expect(options.projectRules).toEqual({
      url: "https://cdn.example.com/wide-events/project-rules.json",
      refreshIntervalMs: 60_000,
    });
  });
});
