import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProjectRulesManager,
  parseProjectRulesDocument,
} from "./project-rules";

describe("parseProjectRulesDocument", () => {
  it("parses valid CDN project rules", () => {
    const parsed = parseProjectRulesDocument({
      version: 1,
      rules: [
        {
          project_id: "project_checkout",
          project_rule_version: "rules-v1",
          match: {
            method: "post",
            path: "/checkout",
          },
          fields: [
            {
              field: "order.total",
              source: "response.body",
              path: "total",
              type: "DOUBLE",
            },
            {
              field: "checkout.status_code",
              source: "response.status",
              type: "BIGINT",
            },
          ],
        },
      ],
    });

    expect(parsed).toEqual({
      version: 1,
      rules: [
        {
          project_id: "project_checkout",
          project_rule_version: "rules-v1",
          match: {
            method: "POST",
            path: "/checkout",
          },
          fields: [
            {
              field: "order.total",
              source: "response.body",
              path: "total",
              type: "DOUBLE",
              optional: false,
            },
            {
              field: "checkout.status_code",
              source: "response.status",
              type: "BIGINT",
              optional: false,
            },
          ],
        },
      ],
    });
  });

  it("rejects invalid CDN project rules", () => {
    expect(() =>
      parseProjectRulesDocument({
        version: 1,
        rules: [
          {
            project_id: "project_checkout",
            project_rule_version: "rules-v1",
            match: {
              method: "POST",
              path: "/checkout",
            },
            fields: [
              {
                field: "project_id",
                source: "request.body",
                type: "DOUBLE",
              },
            ],
          },
        ],
      }),
    ).toThrow(/reserved|dot path/u);
  });
});

describe("ProjectRulesManager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fetch project rules during construction", () => {
    const fetchImpl = vi.fn<typeof fetch>();

    new ProjectRulesManager({
      projects: {
        ids: ["project_checkout"],
        refreshIntervalMs: 1_000,
      },
      apiKey: "we_key_123",
      apiUrl: "https://api.example.com",
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("discovers SaaS project rules on first use", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(createDiscoveryResponse("rules-v1")));
    const manager = new ProjectRulesManager({
      projects: {
        ids: ["project_checkout"],
        refreshIntervalMs: 1_000,
      },
      apiKey: "we_key_123",
      apiUrl: "https://api.example.com/",
      fetchImpl,
    });

    await expect(manager.getRules()).resolves.toEqual([
      expect.objectContaining({
        project_id: "project_checkout",
        project_rule_version: "rules-v1",
      }),
    ]);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.com/v1/sdk/projects/discover",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      projectIds: ["project_checkout"],
    });
    expect(manager.currentDocument()).toEqual({
      version: 1,
      rules: [
        expect.objectContaining({
          project_id: "project_checkout",
          project_rule_version: "rules-v1",
        }),
      ],
    });
    expect(manager.currentRules()).toEqual([
      expect.objectContaining({
        project_id: "project_checkout",
        project_rule_version: "rules-v1",
      }),
    ]);
  });

  it("starts background refreshes without blocking current-rule reads", async () => {
    const discovery = createDeferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>().mockReturnValue(discovery.promise);
    const manager = new ProjectRulesManager({
      projects: {
        ids: ["project_checkout"],
        refreshIntervalMs: 1_000,
      },
      apiKey: "we_key_123",
      apiUrl: "https://api.example.com/",
      fetchImpl,
    });

    manager.refreshSoon();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(manager.currentRules()).toEqual([]);

    discovery.resolve(jsonResponse(createDiscoveryResponse("rules-v1")));

    await expect(manager.getRules()).resolves.toEqual([
      expect.objectContaining({
        project_id: "project_checkout",
        project_rule_version: "rules-v1",
      }),
    ]);
    expect(manager.currentRules()).toEqual([
      expect.objectContaining({
        project_id: "project_checkout",
        project_rule_version: "rules-v1",
      }),
    ]);
  });

  it("caches discovered rules until the refresh interval expires, then polls the CDN", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T00:00:00.000Z"));

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(createDiscoveryResponse("rules-v1")))
      .mockResolvedValueOnce(jsonResponse(createDiscoveryResponse("rules-v2")));
    const manager = new ProjectRulesManager({
      projects: {
        ids: ["project_checkout"],
        refreshIntervalMs: 1_000,
      },
      apiKey: "we_key_123",
      apiUrl: "https://api.example.com",
      fetchImpl,
    });

    await expect(manager.getRules()).resolves.toEqual([
      expect.objectContaining({ project_rule_version: "rules-v1" }),
    ]);
    await expect(manager.getRules()).resolves.toEqual([
      expect.objectContaining({ project_rule_version: "rules-v1" }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(999);
    await expect(manager.getRules()).resolves.toEqual([
      expect.objectContaining({ project_rule_version: "rules-v1" }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await expect(manager.getRules()).resolves.toEqual([
      expect.objectContaining({ project_rule_version: "rules-v2" }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      "https://cdn.example.com/wide-events/rules.json",
    );
    expect(fetchImpl.mock.calls[1]?.[1]).toEqual({
      method: "GET",
      headers: {
        accept: "application/json",
      },
    });
  });

  it("disables extraction when initial discovery has no valid rules", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        rulesUrl: "https://cdn.example.com/wide-events/rules.json",
        projects: [
          {
            project_id: "project_checkout",
            rule_version: "rules-v1",
            rules: {
              routes: [
                {
                  match: {
                    method: "POST",
                    path: "/checkout",
                  },
                  fields: [
                    {
                      field: "order.total",
                      source: "request.body",
                      type: "DOUBLE",
                    },
                  ],
                },
              ],
            },
          },
        ],
      }),
    );
    const manager = new ProjectRulesManager({
      projects: {
        ids: ["project_checkout"],
        refreshIntervalMs: 1_000,
      },
      apiKey: "we_key_123",
      apiUrl: "https://api.example.com",
      fetchImpl,
    });

    await expect(manager.getRules()).resolves.toEqual([]);
    expect(manager.currentDocument()).toBeNull();
    expect(manager.lastError).toBeInstanceOf(Error);
  });

  it("keeps the last valid rules when CDN refresh fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T00:00:00.000Z"));

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(createDiscoveryResponse("rules-v1")))
      .mockRejectedValueOnce(new Error("offline"));
    const manager = new ProjectRulesManager({
      projects: {
        ids: ["project_checkout"],
        refreshIntervalMs: 1_000,
      },
      apiKey: "we_key_123",
      apiUrl: "https://api.example.com",
      fetchImpl,
    });

    await expect(manager.getRules()).resolves.toEqual([
      expect.objectContaining({ project_rule_version: "rules-v1" }),
    ]);

    vi.advanceTimersByTime(1_000);

    await expect(manager.getRules()).resolves.toEqual([
      expect.objectContaining({ project_rule_version: "rules-v1" }),
    ]);
    expect(manager.lastError?.message).toBe("offline");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns no rules when initial discovery fails", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("server failed", { status: 500 }));
    const manager = new ProjectRulesManager({
      projects: {
        ids: ["project_checkout"],
        refreshIntervalMs: 1_000,
      },
      apiKey: "we_key_123",
      apiUrl: "https://api.example.com",
      fetchImpl,
    });

    await expect(manager.getRules()).resolves.toEqual([]);
    expect(manager.currentDocument()).toBeNull();
    expect(manager.lastError?.message).toBe(
      "Project discovery failed (500): server failed",
    );
  });

  it("returns no rules for unauthorized discovery", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("invalid token", { status: 401 }));
    const manager = new ProjectRulesManager({
      projects: {
        ids: ["project_checkout"],
        refreshIntervalMs: 1_000,
      },
      apiKey: "we_key_123",
      apiUrl: "https://api.example.com",
      fetchImpl,
    });

    await expect(manager.getRules()).resolves.toEqual([]);
    expect(manager.currentDocument()).toBeNull();
    expect(manager.lastError?.message).toBe("Project discovery failed (401)");
  });

  it("does not fetch when project features are not configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const manager = new ProjectRulesManager({
      projects: false,
      fetchImpl,
    });

    await expect(manager.getRules()).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not fetch when API activation config is missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const manager = new ProjectRulesManager({
      projects: {
        ids: ["project_checkout"],
        refreshIntervalMs: 1_000,
      },
      apiUrl: "https://api.example.com",
      fetchImpl,
    });

    await expect(manager.getRules()).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function createDiscoveryResponse(ruleVersion: string): unknown {
  return {
    rulesUrl: "https://cdn.example.com/wide-events/rules.json",
    projects: [
      {
        project_id: "project_checkout",
        rule_version: ruleVersion,
        rules: {
          routes: [
            {
              match: {
                method: "POST",
                path: "/checkout",
              },
              fields: [
                {
                  field: "order.total",
                  source: "response.body",
                  path: "total",
                  type: "DOUBLE",
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}
