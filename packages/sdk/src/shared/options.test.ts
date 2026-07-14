import { describe, expect, it } from "vitest";
import {
  resolveEdgeOptions,
  resolveNodeOptions,
  type EdgeWideEventsOptions,
  type WideEventsOptions,
} from "./options";

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

  it("accepts SaaS project config without explicit project ids", () => {
    const options = resolveNodeOptions({
      serviceName: "payments",
      collectorUrl: "http://collector.test",
      projects: {},
    });

    expect(options.projects).toEqual({
      refreshIntervalMs: 60_000,
    });
  });

  it("accepts SaaS project config with explicit project ids", () => {
    const options = resolveNodeOptions({
      serviceName: "payments",
      collectorUrl: "http://collector.test",
      projects: {
        ids: ["project_a", "project_b"],
        refreshIntervalMs: 30_000,
      },
    });

    expect(options.projects).toEqual({
      ids: ["project_a", "project_b"],
      refreshIntervalMs: 30_000,
    });
  });

  it("accepts SaaS API activation options", () => {
    const options = resolveNodeOptions({
      serviceName: "payments",
      collectorUrl: "http://collector.test",
      apiKey: "we_key_123",
      apiUrl: "https://api.example.com",
    });

    expect(options.apiKey).toBe("we_key_123");
    expect(options.apiUrl).toBe("https://api.example.com");
  });

  it("rejects empty project id lists", () => {
    expect(() =>
      resolveNodeOptions({
        serviceName: "payments",
        collectorUrl: "http://collector.test",
        projects: {
          ids: [],
        },
      }),
    ).toThrow();
  });

  it("rejects legacy collector-driven project routing", () => {
    expect(() =>
      resolveNodeOptions({
        serviceName: "payments",
        collectorUrl: "http://collector.test",
        projects: true,
      } as unknown as WideEventsOptions),
    ).toThrow();
  });

  it("rejects legacy project id arrays", () => {
    expect(() =>
      resolveNodeOptions({
        serviceName: "payments",
        collectorUrl: "http://collector.test",
        projects: ["project_a", "project_b"],
      } as unknown as WideEventsOptions),
    ).toThrow();
  });

  it("rejects legacy projectRules config", () => {
    expect(() =>
      resolveNodeOptions({
        serviceName: "payments",
        collectorUrl: "http://collector.test",
        projectRules: {
          url: "https://cdn.example.com/wide-events/project-rules.json",
        },
      } as unknown as WideEventsOptions),
    ).toThrow();
  });

  it("resolves edge options with runtime hooks reattached", () => {
    const fetchImpl = (() => Promise.resolve(new Response("", { status: 204 }))) as typeof fetch;
    const sink = { write: () => undefined };
    const options = resolveEdgeOptions({
      serviceName: "worker",
      collectorUrl: "https://collector.example.com",
      fetchImpl,
      sink,
      projects: {
        ids: ["project_edge"],
      },
    } satisfies EdgeWideEventsOptions);

    expect(options.fetchImpl).toBe(fetchImpl);
    expect(options.sink).toBe(sink);
    expect(options.projects).toEqual({
      ids: ["project_edge"],
      refreshIntervalMs: 60_000,
    });
  });
});
